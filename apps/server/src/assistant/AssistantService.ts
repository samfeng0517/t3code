import {
  type AssistantClockStatus,
  type AssistantDailyReportStatus,
  type AssistantDraft,
  type AssistantDraftFailure,
  type AssistantDraftRefInput,
  AssistantError,
  type AssistantMemory,
  type AssistantProject,
  type AssistantSaveDraftInput,
  type AssistantSettings,
  type AssistantState,
  CommandId,
  DEFAULT_ASSISTANT_MODEL_SELECTION,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ModelSelection,
  type OrchestrationV2DomainEvent,
  type ProviderSessionId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AssistantDraftStore from "./AssistantDraftStore.ts";
import { buildDailyDraftMessage } from "./assistantDraftMessage.ts";
import { DEFAULT_ASSISTANT_MEMORY } from "./assistantMemory.ts";
import * as ErpClient from "./ErpClient.ts";

const MEMORY_FILE = "CLAUDE.md";
const isAssistantError = Schema.is(AssistantError);
const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

/** The ERP workday is the Asia/Taipei calendar date, never the server's own. */
const taipeiDate = (iso: string) =>
  Option.match(DateTime.makeZoned(iso, { timeZone: "Asia/Taipei" }), {
    onNone: () => iso.slice(0, 10),
    onSome: DateTime.formatIsoDate,
  });

/** Start of the open segment plus the hours still owed today, to the minute. */
const expectedEndOf = (
  activeStart: string | null,
  requiredHours: number,
  completedHours: number,
): string | null =>
  activeStart === null
    ? null
    : Option.match(DateTime.make(activeStart), {
        onNone: () => null,
        onSome: (start) =>
          DateTime.formatIso(
            DateTime.nearest(
              DateTime.add(start, {
                milliseconds: Math.max(0, requiredHours - completedHours) * 3_600_000,
              }),
              "minute",
            ),
          ),
      });

const sameModelSelection = Schema.toEquivalence(ModelSelection);

interface ThreadSettings {
  readonly modelSelection: NonNullable<AssistantSettings["modelSelection"]>;
  readonly runtimeMode: AssistantSettings["runtimeMode"];
}

const threadSettingsOf = (assistant: AssistantSettings): ThreadSettings => ({
  modelSelection: assistant.modelSelection ?? DEFAULT_ASSISTANT_MODEL_SELECTION,
  runtimeMode: assistant.runtimeMode,
});

/** Why the assistant's draft tools refused; the MCP handlers turn each into the agent's message. */
export class AssistantAgentDraftError extends Schema.TaggedError<AssistantAgentDraftError>()(
  "AssistantAgentDraftError",
  {
    kind: Schema.Literals([
      "not-assistant-thread",
      "no-draft",
      "submitted",
      "stale",
      "unread-earlier-workday",
      "unavailable",
    ]),
    /** The draft's date, for `submitted` and `unread-earlier-workday`. */
    reportDate: Schema.optional(Schema.String),
  },
) {}

export interface AssistantAgentDraft {
  readonly draft: AssistantDraft;
  /** Before today's first clock-in the agent still works on an earlier day's unsent draft. */
  readonly fromEarlierWorkday: boolean;
}

export interface AssistantProposedDraft {
  readonly items: AssistantDraft["items"];
  readonly problemText: string;
  readonly sources: AssistantDraft["sources"];
}

export class AssistantService extends Context.Service<
  AssistantService,
  {
    readonly findThread: () => Effect.Effect<ThreadId | null, AssistantError>;
    readonly getOrCreateThread: () => Effect.Effect<ThreadId, AssistantError>;
    readonly readMemory: () => Effect.Effect<AssistantMemory, AssistantError>;
    readonly writeMemory: (memory: AssistantMemory) => Effect.Effect<void, AssistantError>;
    readonly getClockStatus: () => Effect.Effect<AssistantClockStatus, AssistantError>;
    readonly clockIn: () => Effect.Effect<AssistantClockStatus, AssistantError>;
    readonly clockOut: () => Effect.Effect<AssistantClockStatus, AssistantError>;
    readonly listProjects: () => Effect.Effect<ReadonlyArray<AssistantProject>, AssistantError>;
    readonly getDailyReport: () => Effect.Effect<AssistantDailyReportStatus, AssistantError>;
    readonly saveDraft: (
      input: AssistantSaveDraftInput,
    ) => Effect.Effect<AssistantDraft, AssistantError>;
    readonly regenerateDraft: (
      input: AssistantDraftRefInput,
    ) => Effect.Effect<AssistantDraft, AssistantError>;
    readonly submitDailyReport: (
      input: AssistantDraftRefInput,
    ) => Effect.Effect<AssistantDraft, AssistantError>;
    /** The most recently triggered draft, for the assistant thread's own agent only. */
    readonly getDraftForAgent: (
      callerThreadId: ThreadId,
    ) => Effect.Effect<AssistantAgentDraft, AssistantAgentDraftError>;
    /** Stores the agent's draft as that draft's next version. */
    readonly proposeDraft: (
      input: AssistantProposedDraft & { readonly callerThreadId: ThreadId },
    ) => Effect.Effect<
      {
        readonly reportDate: string;
        readonly version: number;
        readonly fromEarlierWorkday: boolean;
      },
      AssistantAgentDraftError
    >;
    /** The assistant thread id and every stored draft, on subscribe and after each change. */
    readonly streamState: () => Stream.Stream<AssistantState>;
    /** Forks the settings watcher and the domain-event loop for the server's lifetime. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/assistant/AssistantService") {}

const make = Effect.gen(function* () {
  const erp = yield* ErpClient.ErpClient;
  const drafts = yield* AssistantDraftStore.AssistantDraftStore;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const threadLaunch = yield* ThreadLaunch.ThreadLaunchService;
  const managedFolders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fileContext = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const serviceScope = yield* Scope.Scope;

  const cachedThreadId = yield* SubscriptionRef.make<ThreadId | null>(null);
  const rememberThread = (threadId: ThreadId | null) =>
    SubscriptionRef.get(cachedThreadId).pipe(
      Effect.flatMap((current) =>
        current === threadId ? Effect.void : SubscriptionRef.set(cachedThreadId, threadId),
      ),
    );
  const createLock = yield* Semaphore.make(1);
  // The provider re-reads CLAUDE.md only when its session restarts.
  const memoryReloadPending = yield* Ref.make(false);

  const threadUnavailable = () => new AssistantError({ reason: "thread-unavailable" });
  const memoryIo = () => new AssistantError({ reason: "memory-io" });

  const liveShell = (threadId: ThreadId) =>
    threads.getThreadShell(threadId).pipe(
      Effect.map((shell) => (shell === null || shell.deletedAt !== null ? null : shell)),
      Effect.mapError(threadUnavailable),
    );

  const findThread = Effect.fn("AssistantService.findThread")(function* () {
    const cached = yield* SubscriptionRef.get(cachedThreadId);
    if (cached !== null) {
      if ((yield* liveShell(cached)) !== null) return cached;
      yield* rememberThread(null);
    }
    // Archived assistant threads count too: archiving must not fork the chat or reset its memory.
    const candidates = yield* threads
      .listAssistantThreadIds()
      .pipe(Effect.mapError(threadUnavailable));
    for (const threadId of candidates) {
      const shell = yield* liveShell(threadId);
      if (shell === null || !(yield* managedFolders.isScratchProject(shell.projectId))) continue;
      yield* rememberThread(threadId);
      return threadId;
    }
    return null;
  });

  const memoryPath = Effect.fn("AssistantService.memoryPath")(function* (threadId: ThreadId) {
    const shell = yield* liveShell(threadId);
    if (shell === null) return yield* threadUnavailable();
    if (shell.worktreePath === null) return yield* memoryIo();
    return path.join(shell.worktreePath, MEMORY_FILE);
  });

  const writeMemoryFile = (filePath: string, contents: string) =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provide(fileContext),
      Effect.mapError(memoryIo),
    );

  const ensureMemoryFile = Effect.fn("AssistantService.ensureMemoryFile")(function* (
    threadId: ThreadId,
  ) {
    const filePath = yield* memoryPath(threadId);
    if (!(yield* fs.exists(filePath).pipe(Effect.mapError(memoryIo)))) {
      yield* writeMemoryFile(filePath, DEFAULT_ASSISTANT_MEMORY);
    }
    return filePath;
  });

  const getOrCreateThread = Effect.fn("AssistantService.getOrCreateThread")(function* () {
    const existing = yield* findThread();
    if (existing !== null) return existing;
    const { projectId } = yield* managedFolders.ensureScratchProject.pipe(
      Effect.mapError(threadUnavailable),
    );
    const settings = yield* settingsService.getSettings.pipe(Effect.mapError(threadUnavailable));
    const { modelSelection, runtimeMode } = threadSettingsOf(settings.assistant);
    const launched = yield* threadLaunch
      .launch({
        commandId: CommandId.make(`assistant-thread:create:${yield* randomUuidV4}`),
        projectId,
        title: "助理",
        modelSelection,
        runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        workspaceStrategy: { type: "root" },
        assistant: true,
        createdBy: "system",
        creationSource: "server",
      })
      .pipe(Effect.mapError(threadUnavailable));
    yield* rememberThread(launched.threadId);
    yield* ensureMemoryFile(launched.threadId);
    return launched.threadId;
  }, createLock.withPermits(1));

  /** Releases the thread's idle sessions; false when one stayed up and must be retried. */
  const releaseSessions = Effect.fn("AssistantService.releaseSessions")(function* (
    threadId: ThreadId,
  ) {
    const shell = yield* liveShell(threadId);
    if (shell === null) return true;
    if (shell.activeRunId !== null) return false;
    const records = yield* threads
      .getThreadRecords(threadId, ["providerThreads"])
      .pipe(Effect.mapError(threadUnavailable));
    const sessionIds = new Set<ProviderSessionId>(
      records.providerThreads.flatMap((providerThread) =>
        providerThread.appThreadId === threadId && providerThread.providerSessionId !== null
          ? [providerThread.providerSessionId]
          : [],
      ),
    );
    let allReleased = true;
    for (const providerSessionId of sessionIds) {
      if (!(yield* sessions.isLive(providerSessionId))) continue;
      // A process shared with another working thread stays up; it reloads with its next session.
      if ((yield* sessions.otherWorkingThreads({ providerSessionId, threadId })).length > 0) {
        continue;
      }
      const released = yield* sessions
        .releaseUnlessBusy({
          providerSessionId,
          ownProviderThreadIds: [],
          reason: "idle_timeout",
          detail: "assistant memory changed",
        })
        .pipe(Effect.orElseSucceed(() => false));
      if (!released) allReleased = false;
    }
    return allReleased;
  });

  const readMemory = Effect.fn("AssistantService.readMemory")(function* () {
    const filePath = yield* ensureMemoryFile(yield* getOrCreateThread());
    const content = yield* fs.readFileString(filePath).pipe(Effect.mapError(memoryIo));
    return { content };
  });

  const writeMemory = Effect.fn("AssistantService.writeMemory")(function* (
    memory: AssistantMemory,
  ) {
    const threadId = yield* getOrCreateThread();
    yield* writeMemoryFile(yield* memoryPath(threadId), memory.content);
    const released = yield* releaseSessions(threadId).pipe(Effect.orElseSucceed(() => false));
    yield* Ref.set(memoryReloadPending, !released);
  });

  const triggerLock = yield* Semaphore.make(1);
  /** The workday ERP gave the last clock read, and the Asia/Taipei date ERP read it on. */
  const lastClockWorkday = yield* Ref.make<{
    readonly workday: string;
    readonly readOn: string;
  } | null>(null);
  const submitLock = yield* Semaphore.make(1);
  const draftsUnavailable = () => new AssistantError({ reason: "unavailable" });
  const fail = (reason: AssistantError["reason"]) => new AssistantError({ reason });

  const readDrafts = drafts.read().pipe(Effect.mapError(draftsUnavailable));
  const readDraft = (reportDate: string) =>
    readDrafts.pipe(Effect.map((file) => file.drafts[reportDate]));

  /** Replaces one draft under the store lock; `f` returns an error to leave the file as it is. */
  const updateDraft = Effect.fn("AssistantService.updateDraft")(function* (
    reportDate: string,
    f: (draft: AssistantDraft | undefined) => AssistantDraft | AssistantError,
  ) {
    const refused = yield* drafts
      .update((file) => {
        const next = f(file.drafts[reportDate]);
        return isAssistantError(next)
          ? ([next, file] as const)
          : ([null, { ...file, drafts: { ...file.drafts, [reportDate]: next } }] as const);
      })
      .pipe(Effect.mapError(draftsUnavailable));
    if (refused !== null) return yield* refused;
    const stored = yield* readDraft(reportDate);
    if (stored === undefined) return yield* draftsUnavailable();
    return stored;
  });

  const runActive = Effect.fn("AssistantService.runActive")(function* () {
    const threadId = yield* findThread();
    if (threadId === null) return false;
    return ((yield* liveShell(threadId))?.activeRunId ?? null) !== null;
  });

  const composeDraftMessage = Effect.fn("AssistantService.composeDraftMessage")(function* (
    today: ErpClient.ErpTodayReport,
  ) {
    const projects = yield* erp.listProjects().pipe(Effect.option);
    const projectName = (item: ErpClient.ErpPrefillItem) => {
      const projectId = item.project_id;
      if (projectId === null) return item.project_other;
      const found = Option.getOrUndefined(projects)?.find((project) => project.id === projectId);
      return found?.name ?? `#${projectId}`;
    };
    const activities = yield* erp.listActivities().pipe(Effect.option);
    return buildDailyDraftMessage({
      reportDate: today.server_date,
      prefill: today.prefill_items.map((item) => ({
        section: item.section,
        status: item.status,
        project: projectName(item),
        content: item.content,
      })),
      activities: Option.match(activities, {
        onNone: () => null,
        onSome: (list) =>
          list.map((activity) => ({
            status: activity.status ?? "",
            project: activity.project_name,
            title: activity.title,
          })),
      }),
    });
  });

  const failureOfRun = (status: string): AssistantDraftFailure | null =>
    !TERMINAL_RUN_STATUSES.has(status) ? null : status === "failed" ? "run-failed" : "no-proposal";

  /** A generating draft whose trigger run ended got no proposal; the proposal tool sets ready. */
  const failDraftForRun = Effect.fn("AssistantService.failDraftForRun")(function* (
    runId: RunId,
    failure: AssistantDraftFailure,
  ) {
    const file = yield* readDrafts;
    for (const draft of Object.values(file.drafts)) {
      if (draft.status !== "generating" || draft.triggerRunId !== runId) continue;
      yield* updateDraft(draft.reportDate, (current) =>
        current?.status === "generating" && current.triggerRunId === runId
          ? { ...current, status: "failed", failure }
          : (current ?? fail("no-draft")),
      );
    }
  });

  const reconcileGenerating = Effect.fn("AssistantService.reconcileGenerating")(function* (
    threadId: ThreadId,
  ) {
    const generating = Object.values((yield* readDrafts).drafts).filter(
      (draft) => draft.status === "generating" && draft.triggerRunId !== undefined,
    );
    if (generating.length === 0) return;
    const { runs } = yield* threads
      .getThreadRecords(threadId, ["runs"], {
        runIds: generating.flatMap((draft) =>
          draft.triggerRunId === undefined ? [] : [draft.triggerRunId],
        ),
      })
      .pipe(Effect.mapError(threadUnavailable));
    for (const draft of generating) {
      const run = runs.find((candidate) => candidate.id === draft.triggerRunId);
      const failure = run === undefined ? null : failureOfRun(run.status);
      if (run !== undefined && failure !== null) yield* failDraftForRun(run.id, failure);
    }
  });

  /** The assistant thread and message text, gathered before the draft turns generating. */
  const prepareDraftMessage = Effect.fn("AssistantService.prepareDraftMessage")(function* (
    today: ErpClient.ErpTodayReport,
  ) {
    const threadId = yield* getOrCreateThread();
    const shell = yield* liveShell(threadId);
    if (shell === null) return yield* threadUnavailable();
    // An archived thread refuses messages; the assistant chat stays usable.
    if (shell.archivedAt !== null) {
      yield* threads
        .dispatch({
          type: "thread.unarchive",
          commandId: CommandId.make(`assistant-thread:unarchive:${yield* randomUuidV4}`),
          threadId,
        })
        .pipe(Effect.mapError(threadUnavailable));
    }
    const settings = yield* settingsService.getSettings.pipe(Effect.mapError(threadUnavailable));
    return {
      threadId,
      projectId: shell.projectId,
      modelSelection: threadSettingsOf(settings.assistant).modelSelection,
      text: yield* composeDraftMessage(today),
    };
  });

  const newDraft = (reportDate: string, updatedAt: string): AssistantDraft => ({
    reportDate,
    status: "generating",
    items: [],
    problemText: "",
    revision: 0,
    version: 0,
    sources: [],
    editedByUser: false,
    triggerAttempt: 1,
    updatedAt,
  });

  /**
   * Marks the draft generating, sends the request and stores its run id as one step. A client
   * that disconnects in between would otherwise leave a generating draft that no run settles.
   */
  const dispatchDraft = Effect.fn("AssistantService.dispatchDraft")(function* (input: {
    readonly reportDate: string;
    readonly summary: string;
    readonly prepared: Effect.Success<ReturnType<typeof prepareDraftMessage>>;
    readonly start: (draft: AssistantDraft | undefined) => AssistantDraft | AssistantError;
  }) {
    const { prepared } = input;
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const started = yield* updateDraft(input.reportDate, input.start);
        const id = `assistant-daily-draft:${input.reportDate}:${started.triggerAttempt}`;
        const result = yield* threads
          .sendToThread({
            projectId: prepared.projectId,
            threadId: prepared.threadId,
            commandId: CommandId.make(id),
            messageId: MessageId.make(id),
            text: prepared.text,
            attachments: [],
            modelSelection: prepared.modelSelection,
            mode: "queue",
            // The orchestrator only accepts notifications on agent-attributed, server-sent queued messages.
            createdBy: "agent",
            creationSource: "server",
            notification: {
              source: { kind: "system" },
              outcome: "updated",
              summary: input.summary,
            },
          })
          .pipe(
            Effect.mapError(threadUnavailable),
            Effect.tapError(() =>
              updateDraft(input.reportDate, (draft) =>
                draft === undefined
                  ? fail("no-draft")
                  : { ...draft, status: "failed", failure: "thread-unavailable" },
              ).pipe(Effect.ignore({ log: true })),
            ),
          );
        yield* updateDraft(input.reportDate, (draft) =>
          draft === undefined ? fail("no-draft") : { ...draft, triggerRunId: result.run.id },
        ).pipe(
          // Without its run id no run settles the draft; a failed one can still be retried,
          // and the assistant's proposal still lands on it.
          Effect.tapError(() =>
            updateDraft(input.reportDate, (draft) =>
              draft === undefined
                ? fail("no-draft")
                : { ...draft, status: "failed", failure: "thread-unavailable" },
            ).pipe(Effect.ignore({ log: true })),
          ),
        );
      }),
    );
    // The run may have ended before its id was stored, so the event loop could not match it.
    yield* reconcileGenerating(prepared.threadId).pipe(Effect.ignore({ log: true }));
    const stored = yield* readDraft(input.reportDate);
    if (stored === undefined) return yield* draftsUnavailable();
    return stored;
  });

  /** Report dates ERP already closed (exempt or submitted); they never trigger a draft. */
  const closedReportDates = new Set<string>();
  /** Generating drafts this process is still preparing; startup recovery must leave them alone. */
  const preparingReportDates = new Set<string>();

  const draftForNewWorkday = Effect.fn("AssistantService.draftForNewWorkday")(function* (
    reportDate: string,
    today: ErpClient.ErpTodayReport,
  ) {
    const prepared = yield* prepareDraftMessage(today).pipe(
      Effect.tapError(() =>
        updateDraft(reportDate, (draft) =>
          draft === undefined
            ? fail("no-draft")
            : { ...draft, status: "failed", failure: "thread-unavailable" },
        ).pipe(Effect.ignore({ log: true })),
      ),
    );
    yield* dispatchDraft({
      reportDate,
      summary: "今天第一次打卡，助理開始擬日報草稿",
      prepared,
      start: (draft) =>
        draft?.status === "generating" && draft.triggerRunId === undefined ? draft : fail("busy"),
    });
  });

  const maybeTriggerDraft = Effect.fn("AssistantService.maybeTriggerDraft")(function* (
    status: AssistantClockStatus,
  ) {
    const reportDate = status.reportDate;
    if (status.segments.length === 0 || closedReportDates.has(reportDate)) return;
    if ((yield* readDraft(reportDate)) !== undefined) return;
    const today = yield* erp.getTodayReport();
    if (today.server_date !== reportDate) return;
    if (today.daily_report_exempt || (today.report?.submitted_at ?? null) !== null) {
      closedReportDates.add(reportDate);
      return;
    }
    // The clock reply waits only for the generating draft, so the chip never reads "after
    // clock-in" once the user clocked in; the request that stored it drafts in the background.
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const stored = yield* triggerLock.withPermits(1)(
          updateDraft(reportDate, (draft) =>
            draft === undefined ? newDraft(reportDate, status.serverNow) : fail("busy"),
          ).pipe(
            Effect.tap(() => Effect.sync(() => preparingReportDates.add(reportDate))),
            Effect.as(true),
            Effect.catchIf(
              (error) => error.reason === "busy",
              () => Effect.succeed(false),
            ),
          ),
        );
        if (!stored) return;
        yield* draftForNewWorkday(reportDate, today).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("assistant draft was not triggered", { cause }),
          ),
          Effect.ensuring(Effect.sync(() => preparingReportDates.delete(reportDate))),
          Effect.interruptible,
          Effect.forkIn(serviceScope),
        );
      }),
    );
  });

  const getDailyReport = Effect.fn("AssistantService.getDailyReport")(function* () {
    const before = yield* readDrafts;
    const today = yield* erp.getTodayReport();
    const settings = yield* settingsService.getSettings.pipe(Effect.mapError(draftsUnavailable));
    const submittedAt = today.report?.submitted_at ?? null;
    const cached = before.drafts[today.server_date];
    if (submittedAt === null && cached?.status === "submitted") {
      // `submitted` is only a cache of ERP's record. A newer revision means a submit landed
      // after ERP answered, so that one stays.
      yield* updateDraft(today.server_date, (draft) => {
        if (draft?.status !== "submitted" || draft.revision !== cached.revision) {
          return fail("stale-revision");
        }
        const { submittedAt: _submittedAt, ...rest } = draft;
        return { ...rest, status: "ready" };
      }).pipe(
        Effect.catchIf(
          (error) => error.reason === "stale-revision",
          () => Effect.void,
        ),
      );
    }
    if (submittedAt !== null) {
      const stored = yield* readDraft(today.server_date);
      // ERP is the record: a report sent from its own page still closes the draft here.
      if (stored !== undefined && stored.status !== "submitted") {
        yield* updateDraft(today.server_date, (draft) =>
          draft === undefined ? fail("no-draft") : { ...draft, status: "submitted", submittedAt },
        );
      }
    }
    return {
      reportDate: today.server_date,
      exempt: today.daily_report_exempt,
      submittedAt,
      erpDailyReportUrl: `${settings.assistant.erpBaseUrl.replace(/\/+$/u, "")}/profile/daily-report`,
    } satisfies AssistantDailyReportStatus;
  });

  const editable = (draft: AssistantDraft | undefined, revision: number) =>
    draft === undefined
      ? fail("no-draft")
      : draft.status !== "ready"
        ? fail("not-editable")
        : draft.revision !== revision
          ? fail("stale-revision")
          : draft;

  const saveDraft = Effect.fn("AssistantService.saveDraft")(function* (
    input: AssistantSaveDraftInput,
  ) {
    return yield* updateDraft(input.reportDate, (draft) => {
      const checked = editable(draft, input.revision);
      return isAssistantError(checked)
        ? checked
        : { ...checked, items: input.items, problemText: input.problemText, editedByUser: true };
    });
  });

  const regenerateDraft = Effect.fn("AssistantService.regenerateDraft")(function* (
    input: AssistantDraftRefInput,
  ) {
    const check = (draft: AssistantDraft | undefined) =>
      draft === undefined
        ? fail("no-draft")
        : draft.status === "submitted"
          ? fail("submitted")
          : draft.status === "generating"
            ? fail("busy")
            : draft.revision !== input.revision
              ? fail("stale-revision")
              : draft;
    const checked = check(yield* readDraft(input.reportDate));
    if (isAssistantError(checked)) return yield* checked;
    if (yield* runActive()) return yield* fail("busy");
    const today = yield* erp.getTodayReport();
    // The message carries ERP's current day, so only that day's draft can be redrafted.
    if (today.server_date !== input.reportDate) return yield* fail("not-editable");
    return yield* triggerLock.withPermits(1)(
      Effect.gen(function* () {
        const prepared = yield* prepareDraftMessage(today);
        return yield* dispatchDraft({
          reportDate: input.reportDate,
          summary: "重新產生日報草稿",
          prepared,
          start: (draft) => {
            const current = check(draft);
            if (isAssistantError(current)) return current;
            const { failure: _failure, triggerRunId: _triggerRunId, ...rest } = current;
            return { ...rest, status: "generating", triggerAttempt: current.triggerAttempt + 1 };
          },
        });
      }),
    );
  });

  const submitDailyReport = Effect.fn("AssistantService.submitDailyReport")(function* (
    input: AssistantDraftRefInput,
  ) {
    const checked = editable(yield* readDraft(input.reportDate), input.revision);
    if (isAssistantError(checked)) return yield* checked;
    const items = (["yesterday", "today"] as const).flatMap((section) =>
      checked.items
        .filter((item) => item.section === section && item.content.trim() !== "")
        .toSorted((left, right) => left.sortOrder - right.sortOrder)
        .map((item, index) => ({
          section,
          // "Other" without a name counts as no project.
          ...(item.projectOther !== null
            ? item.projectOther.trim() === ""
              ? {}
              : { project_other: item.projectOther }
            : item.projectId !== null
              ? { project_id: item.projectId }
              : {}),
          content: item.content,
          status: item.status,
          sort_order: index,
        })),
    );
    if (yield* runActive()) return yield* fail("busy");
    const today = yield* erp.getTodayReport();
    const alreadySubmitted = today.report?.submitted_at ?? null;
    if (today.server_date === input.reportDate && alreadySubmitted !== null) {
      yield* updateDraft(input.reportDate, (draft) =>
        draft === undefined
          ? fail("no-draft")
          : { ...draft, status: "submitted", submittedAt: alreadySubmitted },
      );
      return yield* fail("submitted");
    }
    // ERP would file an empty report and forward it to Slack.
    if (items.length === 0) return yield* fail("not-editable");
    yield* erp.submitReport({
      date: input.reportDate,
      ...(checked.problemText.trim() === "" ? {} : { problem_text: checked.problemText }),
      items,
    });
    const submittedAt = DateTime.formatIso(yield* DateTime.now);
    // An edit saved while the POST ran never reached ERP, so keep what was sent.
    return yield* updateDraft(input.reportDate, (draft) =>
      draft === undefined
        ? fail("no-draft")
        : {
            ...draft,
            items: checked.items,
            problemText: checked.problemText,
            status: "submitted",
            submittedAt,
          },
    );
  }, submitLock.withPermits(1));

  const currentState = Effect.gen(function* () {
    const { drafts: stored } = yield* drafts.read();
    return {
      assistantThreadId: yield* SubscriptionRef.get(cachedThreadId),
      drafts: Object.values(stored).toSorted((left, right) =>
        right.reportDate.localeCompare(left.reportDate),
      ),
    } satisfies AssistantState;
  });

  const streamState = () =>
    Stream.unwrap(
      findThread().pipe(
        Effect.ignore,
        Effect.as(
          Stream.merge(
            SubscriptionRef.changes(cachedThreadId).pipe(Stream.map(() => undefined)),
            drafts.changes.pipe(Stream.map(() => undefined)),
          ).pipe(
            // A failed read skips the push; an empty list would tell clients the drafts are gone.
            Stream.mapEffect(() =>
              currentState.pipe(
                Effect.tapError((cause) =>
                  Effect.logWarning("assistant drafts were not read for the state stream", {
                    cause,
                  }),
                ),
                Effect.option,
              ),
            ),
            Stream.filter(Option.isSome),
            Stream.map((state) => state.value),
          ),
        ),
      ),
    );

  const getClockStatus = Effect.fn("AssistantService.getClockStatus")(function* () {
    const active = yield* erp.getActiveClocking();
    const workday = active.data?.date ?? taipeiDate(active.meta.server_now);
    yield* Ref.set(lastClockWorkday, { workday, readOn: taipeiDate(active.meta.server_now) });
    const clockings = yield* erp.listClockings(workday.slice(0, 7));
    const segments = clockings
      .filter((clocking) => clocking.date === workday && clocking.type === "ordinary")
      .toSorted((left, right) => Date.parse(left.start_time) - Date.parse(right.start_time))
      .map((clocking) => ({
        start: clocking.start_time,
        end: clocking.end_time,
        hours: clocking.hours,
      }));
    const completedHours = active.meta.today_ordinary_hours;
    const requiredHours = active.meta.today_required_hours;
    const activeStart = active.data?.type === "ordinary" ? active.data.start_time : null;
    const status = {
      reportDate: workday,
      serverNow: active.meta.server_now,
      segments,
      activeStart,
      completedHours,
      requiredHours,
      expectedEnd: expectedEndOf(activeStart, requiredHours, completedHours),
    } satisfies AssistantClockStatus;
    // The first ordinary clocking of the day asks the assistant for the draft; never fails the clock.
    yield* maybeTriggerDraft(status).pipe(
      Effect.catch((cause) => Effect.logWarning("assistant draft was not triggered", { cause })),
    );
    return status;
  });

  const clockIn = Effect.fn("AssistantService.clockIn")(function* () {
    yield* erp.clockIn();
    return yield* getClockStatus();
  });

  const clockOut = Effect.fn("AssistantService.clockOut")(function* () {
    yield* erp.clockOut();
    return yield* getClockStatus();
  });

  const listProjects = Effect.fn("AssistantService.listProjects")(function* () {
    const projects = yield* erp.listProjects();
    return projects.map(({ id, name }) => ({ id, name }));
  });

  const applyThreadSettings = Effect.fn("AssistantService.applyThreadSettings")(function* (
    previous: ThreadSettings,
    next: ThreadSettings,
  ) {
    const threadId = yield* findThread();
    if (threadId === null) return;
    if (!sameModelSelection(previous.modelSelection, next.modelSelection)) {
      yield* threads.dispatch({
        type: "thread.model-selection.set",
        commandId: CommandId.make(`assistant-settings:model:${yield* randomUuidV4}`),
        threadId,
        modelSelection: next.modelSelection,
      });
    }
    if (previous.runtimeMode !== next.runtimeMode) {
      yield* threads.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make(`assistant-settings:runtime:${yield* randomUuidV4}`),
        threadId,
        runtimeMode: next.runtimeMode,
      });
    }
  });

  const watchSettings = Effect.gen(function* () {
    const initial = yield* settingsService.getSettings;
    const last = yield* Ref.make(threadSettingsOf(initial.assistant));
    yield* Stream.runForEach(settingsService.streamChanges, (settings) =>
      Effect.gen(function* () {
        const next = threadSettingsOf(settings.assistant);
        const previous = yield* Ref.getAndSet(last, next);
        yield* applyThreadSettings(previous, next).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("assistant thread settings were not applied", { cause }),
          ),
        );
      }),
    );
  }).pipe(
    Effect.catch((cause) => Effect.logWarning("assistant settings watcher stopped", { cause })),
  );

  // Untraced: it sees every domain event on the server; releaseSessions keeps its own span.
  const handleDomainEvent = Effect.fnUntraced(function* (event: OrchestrationV2DomainEvent) {
    if (event.type !== "run.updated") return;
    const failure = failureOfRun(event.payload.status);
    if (failure === null) return;
    if (event.threadId !== (yield* SubscriptionRef.get(cachedThreadId))) return;
    yield* failDraftForRun(event.payload.id, failure).pipe(Effect.ignore({ log: true }));
    if (yield* Ref.getAndSet(memoryReloadPending, false)) {
      yield* releaseSessions(event.threadId).pipe(Effect.ignore({ log: true }));
    }
  });

  const agentRefused = (kind: AssistantAgentDraftError["kind"]) =>
    new AssistantAgentDraftError({ kind });

  /**
   * The draft revision the agent last read or wrote; card edits after it are unseen. A write, or
   * a read made while the draft was still today's, leaves the earlier-workday note unseen.
   */
  const agentSeenRevision = yield* Ref.make<{
    readonly reportDate: string;
    readonly revision: number;
    readonly sawEarlierWorkdayNote: boolean;
  } | null>(null);

  /** ERP's workday trails the calendar date while a segment that began before midnight is open. */
  const currentWorkday = Effect.fn("AssistantService.currentWorkday")(function* () {
    const clockDate = taipeiDate(DateTime.formatIso(yield* DateTime.now));
    const read = yield* Ref.get(lastClockWorkday);
    // No ERP clock read on this date yet: fall back to the server clock's Asia/Taipei date.
    return read !== null && read.readOn === clockDate ? read.workday : clockDate;
  });

  /**
   * The draft the agent works on: the newest report date, i.e. the last one triggered. After
   * midnight that stays yesterday's until today's first clock-in triggers a new draft; a
   * submitted one from an earlier day means today's has not started.
   */
  const agentDraft = Effect.fn("AssistantService.agentDraft")(function* (callerThreadId: ThreadId) {
    const threadId = yield* findThread().pipe(Effect.mapError(() => agentRefused("unavailable")));
    if (threadId !== callerThreadId) return yield* agentRefused("not-assistant-thread");
    const file = yield* drafts.read().pipe(Effect.mapError(() => agentRefused("unavailable")));
    const newest = Object.keys(file.drafts).toSorted().at(-1);
    const draft = newest === undefined ? undefined : file.drafts[newest];
    if (draft === undefined) return yield* agentRefused("no-draft");
    const fromEarlierWorkday = draft.reportDate < (yield* currentWorkday());
    if (draft.status === "submitted") {
      return yield* fromEarlierWorkday
        ? agentRefused("no-draft")
        : new AssistantAgentDraftError({ kind: "submitted", reportDate: draft.reportDate });
    }
    return { draft, fromEarlierWorkday } satisfies AssistantAgentDraft;
  });

  const getDraftForAgent = Effect.fn("AssistantService.getDraftForAgent")(function* (
    callerThreadId: ThreadId,
  ) {
    const found = yield* agentDraft(callerThreadId);
    yield* Ref.set(agentSeenRevision, {
      reportDate: found.draft.reportDate,
      revision: found.draft.revision,
      sawEarlierWorkdayNote: found.fromEarlierWorkday,
    });
    return found;
  });

  const proposeDraft = Effect.fn("AssistantService.proposeDraft")(function* (
    input: AssistantProposedDraft & { readonly callerThreadId: ThreadId },
  ) {
    const {
      draft: { reportDate },
      fromEarlierWorkday,
    } = yield* agentDraft(input.callerThreadId);
    const seen = yield* Ref.get(agentSeenRevision);
    // Only the get tool's note tells the agent which day this is; without it "today" lands here.
    if (fromEarlierWorkday && (seen?.reportDate !== reportDate || !seen.sawEarlierWorkdayNote)) {
      return yield* new AssistantAgentDraftError({ kind: "unread-earlier-workday", reportDate });
    }
    const stored = yield* updateDraft(reportDate, (draft) => {
      if (draft === undefined) return fail("no-draft");
      if (draft.status === "submitted") return fail("submitted");
      // Only a ready draft takes card edits; replacing one the agent has not read would drop them.
      if (
        draft.status === "ready" &&
        (seen?.reportDate !== reportDate || seen.revision !== draft.revision)
      ) {
        return fail("stale-revision");
      }
      const { failure: _failure, ...rest } = draft;
      return {
        ...rest,
        items: input.items.map((item) => ({ ...item, content: item.content.trim() })),
        problemText: input.problemText,
        sources: input.sources,
        version: draft.version + 1,
        status: "ready",
        editedByUser: false,
      };
    }).pipe(
      Effect.mapError((error) =>
        error.reason === "no-draft"
          ? agentRefused("no-draft")
          : error.reason === "submitted"
            ? fromEarlierWorkday
              ? agentRefused("no-draft")
              : new AssistantAgentDraftError({ kind: "submitted", reportDate })
            : error.reason === "stale-revision"
              ? agentRefused("stale")
              : agentRefused("unavailable"),
      ),
    );
    yield* Ref.set(agentSeenRevision, {
      reportDate,
      revision: stored.revision,
      sawEarlierWorkdayNote: false,
    });
    return { reportDate: stored.reportDate, version: stored.version, fromEarlierWorkday };
  });

  /** A server that stopped between marking a draft generating and storing its run left it stuck. */
  const recoverUnsentDrafts = triggerLock.withPermits(1)(
    Effect.gen(function* () {
      const file = yield* readDrafts;
      for (const draft of Object.values(file.drafts)) {
        if (draft.status !== "generating" || draft.triggerRunId !== undefined) continue;
        if (preparingReportDates.has(draft.reportDate)) continue;
        yield* updateDraft(draft.reportDate, (current) =>
          current?.status === "generating" && current.triggerRunId === undefined
            ? { ...current, status: "failed", failure: "thread-unavailable" }
            : (current ?? fail("no-draft")),
        );
      }
    }),
  );

  const start = Effect.fn("AssistantService.start")(function* () {
    yield* forkParked(watchSettings);
    yield* forkParked(recoverUnsentDrafts.pipe(Effect.ignore({ log: true })));
    // Trigger runs that ended while the server was down left their drafts generating.
    yield* forkParked(
      findThread().pipe(
        Effect.flatMap((threadId) =>
          threadId === null ? Effect.void : reconcileGenerating(threadId),
        ),
        Effect.ignore({ log: true }),
      ),
    );
    yield* forkParked(
      Stream.runForEach(threads.streamDomainEvents, handleDomainEvent).pipe(
        Effect.catch((cause) => Effect.logWarning("assistant event loop stopped", { cause })),
      ),
    );
  });

  return AssistantService.of({
    findThread,
    getOrCreateThread,
    readMemory,
    writeMemory,
    getClockStatus,
    clockIn,
    clockOut,
    listProjects,
    getDailyReport,
    saveDraft,
    regenerateDraft,
    submitDailyReport,
    getDraftForAgent,
    proposeDraft,
    streamState,
    start,
  });
});

export const layer = Layer.effect(AssistantService, make);
