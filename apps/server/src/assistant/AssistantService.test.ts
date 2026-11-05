import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type AssistantDraft,
  AssistantError,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunId,
  type ServerSettings as ServerSettingsValue,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import type * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AssistantDraftStore from "./AssistantDraftStore.ts";
import * as AssistantService from "./AssistantService.ts";
import { DEFAULT_ASSISTANT_MEMORY } from "./assistantMemory.ts";
import * as ErpClient from "./ErpClient.ts";

const SCRATCH = ProjectId.make("scratch-project");
const NOW = DateTime.makeUnsafe("2026-11-05T00:00:00.000Z");

const assistantShell = (id: string, worktreePath: string): OrchestrationV2ThreadShell => {
  const threadId = ThreadId.make(id);
  return {
    id: threadId,
    projectId: SCRATCH,
    title: "助理",
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-5-5",
    },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath,
    activeProviderThreadId: null,
    lineage: {
      rootThreadId: threadId,
      parentThreadId: null,
      relationshipToParent: null,
      assistant: true,
    },
    forkedFrom: null,
    createdBy: "system",
    creationSource: "server",
    activeRunId: null,
    latestRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
};

const activeClocking = (overrides: Partial<ErpClient.ErpActiveClocking> = {}) =>
  ({
    data: null,
    meta: {
      server_now: "2026-11-05T15:00:00+08:00",
      today_ordinary_hours: 0,
      today_required_hours: 8,
    },
    ...overrides,
  }) satisfies ErpClient.ErpActiveClocking;

const todaySegment: ErpClient.ErpClocking = {
  id: 1,
  date: "2026-11-05",
  type: "ordinary",
  start_time: "2026-11-05T09:00:00+08:00",
  end_time: null,
  hours: 0,
};

const todayReport = (
  overrides: Partial<ErpClient.ErpTodayReport> = {},
): ErpClient.ErpTodayReport => ({
  server_date: "2026-11-05",
  report: null,
  prefill_items: [
    {
      section: "yesterday",
      project_id: 7,
      project_other: null,
      content: "Ship the release",
      status: "finished",
      sort_order: 0,
    },
  ],
  daily_report_exempt: false,
  ...overrides,
});

const storedDraft = (overrides: Partial<AssistantDraft> = {}): AssistantDraft => ({
  reportDate: "2026-11-05",
  status: "ready",
  items: [],
  problemText: "",
  revision: 0,
  version: 1,
  sources: [],
  editedByUser: false,
  triggerAttempt: 1,
  updatedAt: "2026-11-05T00:00:00.000Z",
  ...overrides,
});

/** Writes a draft through the real store and returns it with the revision the store gave it. */
const seedDraft = (draft: AssistantDraft) =>
  Effect.gen(function* () {
    const store = yield* AssistantDraftStore.AssistantDraftStore;
    yield* store.update((file) => [
      undefined,
      { ...file, drafts: { ...file.drafts, [draft.reportDate]: draft } },
    ]);
    return (yield* store.read()).drafts[draft.reportDate]!;
  });

const readStoredDraft = (reportDate: string) =>
  AssistantDraftStore.AssistantDraftStore.pipe(
    Effect.flatMap((store) => store.read()),
    Effect.map((file) => file.drafts[reportDate]),
  );

/** Forks a wait for the stored draft to match; fork it before the step that changes the draft. */
const awaitStoredDraft = (reportDate: string, matches: (draft: AssistantDraft) => boolean) =>
  AssistantDraftStore.AssistantDraftStore.pipe(
    Effect.flatMap((store) =>
      store.changes.pipe(
        Stream.filter((file) => {
          const draft = file.drafts[reportDate];
          return draft !== undefined && matches(draft);
        }),
        Stream.runHead,
        Effect.forkChild({ startImmediately: true }),
      ),
    ),
  );

const runUpdated = (threadId: ThreadId, runId: string, status: string) =>
  ({
    type: "run.updated",
    threadId,
    payload: { id: RunId.make(runId), status },
  }) as unknown as OrchestrationV2DomainEvent;

/** Holds a step open: `started` resolves when it begins, `release` lets it finish. */
interface Gate {
  readonly started: Deferred.Deferred<void>;
  readonly release: Deferred.Deferred<void>;
}

const makeGate = Effect.gen(function* () {
  return {
    started: yield* Deferred.make<void>(),
    release: yield* Deferred.make<void>(),
  } satisfies Gate;
});

const passGate = (gate: Gate | undefined) =>
  gate === undefined
    ? Effect.void
    : Deferred.succeed(gate.started, undefined).pipe(Effect.andThen(Deferred.await(gate.release)));

interface HarnessOptions {
  readonly active?: ErpClient.ErpActiveClocking;
  readonly clockings?: ReadonlyArray<ErpClient.ErpClocking>;
  readonly today?: ErpClient.ErpTodayReport;
  readonly settings?: Parameters<typeof ServerSettings.layerTest>[0];
  /** Holds sendToThread open. */
  readonly sendGate?: Gate;
  /** Holds ERP listProjects open, i.e. the draft message's preparation. */
  readonly projectsGate?: Gate;
  /** Holds every ERP getTodayReport call open; each call offers to `arrived` first. */
  readonly todayGate?: {
    readonly arrived: Queue.Queue<void>;
    readonly release: Deferred.Deferred<void>;
  };
  readonly scratchUnavailable?: boolean;
}

const makeHarness = Effect.fn("makeHarness")(function* (options: HarnessOptions = {}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-assistant-service-" });
  const shells = yield* Ref.make(new Map<ThreadId, OrchestrationV2ThreadShell>());
  const launches = yield* Ref.make(0);
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  const dispatchedOnce = yield* Deferred.make<void>();
  const released = yield* Deferred.make<ProviderSessionId>();
  const releaseCalls = yield* Ref.make(0);
  const settingsChanges = yield* Queue.unbounded<ServerSettingsValue>();
  const domainEvents = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const listedMonths: Array<string> = [];
  const sends: Array<ThreadManagement.ThreadManagementSendInput> = [];
  const submitted: Array<ErpClient.ErpDailyReportBody> = [];
  const erpState: { today: ErpClient.ErpTodayReport; todayFailure?: AssistantError } = {
    today: options.today ?? todayReport(),
  };

  const addShell = (shell: OrchestrationV2ThreadShell) =>
    Ref.update(shells, (current) => new Map(current).set(shell.id, shell));

  const threads = Layer.mock(ThreadManagement.ThreadManagementService)({
    listAssistantThreadIds: () =>
      Ref.get(shells).pipe(
        Effect.map((current) =>
          [...current.values()]
            .filter((shell) => shell.lineage.assistant === true && shell.deletedAt === null)
            .toSorted(
              (left, right) =>
                DateTime.toEpochMillis(right.createdAt) - DateTime.toEpochMillis(left.createdAt),
            )
            .map((shell) => shell.id),
        ),
      ),
    getThreadShell: (threadId) =>
      Ref.get(shells).pipe(Effect.map((current) => current.get(threadId) ?? null)),
    getThreadRecords: ((threadId: ThreadId) =>
      Effect.succeed({
        providerThreads: [
          {
            id: ProviderThreadId.make("provider-thread-1"),
            appThreadId: threadId,
            providerSessionId: ProviderSessionId.make("session-1"),
          },
        ],
        runs: [],
      })) as unknown as ThreadManagement.ThreadManagementService["Service"]["getThreadRecords"],
    sendToThread: (input) =>
      Effect.gen(function* () {
        yield* passGate(options.sendGate);
        sends.push(input);
        return {
          run: { id: RunId.make(`run-${sends.length}`) },
        } as unknown as ThreadManagement.ThreadManagementSendResult;
      }),
    dispatch: (command) =>
      Effect.sync(() => dispatched.push(command)).pipe(
        Effect.andThen(Deferred.succeed(dispatchedOnce, undefined)),
        Effect.as({} as Orchestrator.OrchestratorV2DispatchResult),
      ),
    streamDomainEvents: Stream.fromQueue(domainEvents),
  });

  const launch = Layer.mock(ThreadLaunch.ThreadLaunchService)({
    launch: (input) =>
      Effect.gen(function* () {
        yield* Effect.yieldNow;
        const count = yield* Ref.updateAndGet(launches, (value) => value + 1);
        const worktreePath = path.join(root, `thread-${count}`);
        yield* fs.makeDirectory(worktreePath, { recursive: true }).pipe(Effect.orDie);
        const shell = {
          ...assistantShell(`assistant-${count}`, worktreePath),
          projectId: input.projectId,
          runtimeMode: input.runtimeMode,
        };
        yield* addShell(shell);
        return { threadId: shell.id, resumed: false } as unknown as ThreadLaunch.ThreadLaunchResult;
      }),
  });

  const folders = Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
    ensureScratchProject:
      options.scratchUnavailable === true
        ? Effect.fail(new ManagedProjectFolders.ScratchUnavailableError())
        : Effect.succeed({ projectId: SCRATCH }),
    isScratchProject: (projectId) => Effect.succeed(projectId === SCRATCH),
    namedProjectsRoot: root,
  });

  const providerSessions = Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
    isLive: () => Effect.succeed(true),
    otherWorkingThreads: () => Effect.succeed([]),
    releaseUnlessBusy: (input) =>
      Ref.update(releaseCalls, (value) => value + 1).pipe(
        Effect.andThen(Deferred.succeed(released, input.providerSessionId)),
        Effect.as(true),
      ),
  });

  const erp = Layer.mock(ErpClient.ErpClient)({
    getActiveClocking: () => Effect.succeed(options.active ?? activeClocking()),
    listClockings: (month) =>
      Effect.sync(() => {
        listedMonths.push(month);
        return options.clockings ?? [];
      }),
    clockIn: () => Effect.die("unused"),
    clockOut: () => Effect.die("unused"),
    listProjects: () =>
      passGate(options.projectsGate).pipe(Effect.as([{ id: 7, name: "Example" }])),
    getTodayReport: () =>
      (options.todayGate === undefined
        ? Effect.void
        : Queue.offer(options.todayGate.arrived, undefined).pipe(
            Effect.andThen(Deferred.await(options.todayGate.release)),
          )
      ).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            erpState.todayFailure === undefined
              ? Effect.succeed(erpState.today)
              : Effect.fail(erpState.todayFailure),
          ),
        ),
      ),
    listActivities: () =>
      Effect.succeed([
        { title: "Review MR", status: "processing", project_id: 7, project_name: "Example" },
      ]),
    submitReport: (body) => Effect.sync(() => void submitted.push(body)),
  });

  const settings = Layer.effect(
    ServerSettings.ServerSettingsService,
    Effect.gen(function* () {
      const base = yield* ServerSettings.ServerSettingsService;
      return { ...base, streamChanges: Stream.fromQueue(settingsChanges) };
    }),
  ).pipe(Layer.provide(ServerSettings.layerTest(options.settings)));

  const layer = AssistantService.layer.pipe(
    Layer.provideMerge(
      AssistantDraftStore.layer.pipe(
        Layer.provide(
          Layer.fresh(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3code-assistant-service-state-" }),
          ),
        ),
      ),
    ),
    Layer.provideMerge(Layer.mergeAll(threads, launch, folders, providerSessions, erp, settings)),
  );

  return {
    root,
    layer,
    shells,
    launches,
    dispatched,
    dispatchedOnce,
    released,
    releaseCalls,
    settingsChanges,
    domainEvents,
    listedMonths,
    addShell,
    sends,
    submitted,
    erpState,
  };
});

it.layer(NodeServices.layer)("AssistantService", (it) => {
  it.effect("getOrCreateThread should create one assistant thread when called concurrently", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const assistant = yield* AssistantService.AssistantService;
        const [first, second] = yield* Effect.all(
          [assistant.getOrCreateThread(), assistant.getOrCreateThread()],
          { concurrency: "unbounded" },
        );
        assert.equal(first, second);
        assert.equal(yield* Ref.get(harness.launches), 1);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    { state: "active", archivedAt: null },
    { state: "archived", archivedAt: NOW },
  ])(
    "getOrCreateThread should return the existing thread when one with lineage.assistant is $state",
    ({ archivedAt }) =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* harness.addShell({
          ...assistantShell("existing-assistant", harness.root),
          archivedAt,
        });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          assert.equal(yield* assistant.getOrCreateThread(), "existing-assistant");
          assert.equal(yield* Ref.get(harness.launches), 0);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "getOrCreateThread should write the default CLAUDE.md when the workspace has none",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const harness = yield* makeHarness();
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const threadId = yield* assistant.getOrCreateThread();
          const shell = (yield* Ref.get(harness.shells)).get(threadId);
          const contents = yield* fs.readFileString(path.join(shell!.worktreePath!, "CLAUDE.md"));
          assert.equal(contents, DEFAULT_ASSISTANT_MEMORY);
          assert.equal((yield* assistant.readMemory()).content, DEFAULT_ASSISTANT_MEMORY);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "getClockStatus should compute expectedEnd from activeStart plus remaining hours when a segment is open",
    () =>
      Effect.gen(function* () {
        const open: ErpClient.ErpClocking = {
          id: 2,
          date: "2026-11-05",
          type: "ordinary",
          start_time: "2026-11-05T13:05:00+08:00",
          end_time: null,
          hours: 0,
        };
        const harness = yield* makeHarness({
          active: activeClocking({
            data: open,
            meta: {
              server_now: "2026-11-05T15:00:00+08:00",
              today_ordinary_hours: 2.9833,
              today_required_hours: 8,
            },
          }),
          clockings: [
            open,
            {
              id: 1,
              date: "2026-11-05",
              type: "ordinary",
              start_time: "2026-11-05T09:00:00+08:00",
              end_time: "2026-11-05T11:59:00+08:00",
              hours: 2.9833,
            },
          ],
        });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const status = yield* assistant.getClockStatus();
          // 13:05 + (8:00 - 2:59) = 18:06 in Asia/Taipei.
          assert.equal(status.expectedEnd, "2026-11-05T10:06:00.000Z");
          assert.equal(status.activeStart, "2026-11-05T13:05:00+08:00");
          assert.deepEqual(
            status.segments.map((segment) => segment.start),
            ["2026-11-05T09:00:00+08:00", "2026-11-05T13:05:00+08:00"],
          );
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect("getClockStatus should return expectedEnd null when no segment is open", () =>
    Effect.gen(function* () {
      // 07:00 in Taipei is still the previous day in UTC.
      const harness = yield* makeHarness({
        active: activeClocking({
          meta: {
            server_now: "2026-11-05T07:00:00+08:00",
            today_ordinary_hours: 0,
            today_required_hours: 8,
          },
        }),
      });
      yield* Effect.gen(function* () {
        const assistant = yield* AssistantService.AssistantService;
        const status = yield* assistant.getClockStatus();
        assert.isNull(status.expectedEnd);
        assert.isNull(status.activeStart);
        assert.equal(status.reportDate, "2026-11-05");
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "getClockStatus should use the open clocking date as reportDate when the segment started before midnight",
    () =>
      Effect.gen(function* () {
        const open: ErpClient.ErpClocking = {
          id: 3,
          date: "2026-11-04",
          type: "ordinary",
          start_time: "2026-11-04T23:30:00+08:00",
          end_time: null,
          hours: 0,
        };
        const harness = yield* makeHarness({
          active: activeClocking({
            data: open,
            meta: {
              server_now: "2026-11-05T00:30:00+08:00",
              today_ordinary_hours: 0,
              today_required_hours: 8,
            },
          }),
          clockings: [open, { ...open, id: 4, date: "2026-11-05" }],
        });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const status = yield* assistant.getClockStatus();
          assert.equal(status.reportDate, "2026-11-04");
          assert.lengthOf(status.segments, 1);
          assert.deepEqual(harness.listedMonths, ["2026-11"]);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "settings watcher should dispatch thread.runtime-mode.set when assistant.runtimeMode changes",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* harness.addShell(assistantShell("existing-assistant", harness.root));
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const settings = yield* ServerSettings.ServerSettingsService;
          yield* assistant.start();
          const current = yield* settings.getSettings;
          yield* Queue.offer(harness.settingsChanges, current);
          yield* Queue.offer(harness.settingsChanges, {
            ...current,
            assistant: { ...current.assistant, runtimeMode: "full-access" },
          });
          yield* Deferred.await(harness.dispatchedOnce);
          assert.deepEqual(
            harness.dispatched.map((command) => command.type),
            ["thread.runtime-mode.set"],
          );
          const [command] = harness.dispatched;
          assert.equal(
            command?.type === "thread.runtime-mode.set" && command.runtimeMode,
            "full-access",
          );
          assert.isTrue(command?.commandId.startsWith("assistant-settings:runtime:"));
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect("writeMemory should release the idle session when no run is active", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.addShell(assistantShell("existing-assistant", harness.root));
      yield* Effect.gen(function* () {
        const assistant = yield* AssistantService.AssistantService;
        yield* assistant.writeMemory({ content: "# 助理記憶\n" });
        assert.equal(yield* Deferred.await(harness.released), "session-1");
        assert.equal(yield* Ref.get(harness.releaseCalls), 1);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect("writeMemory should defer the session release when the assistant run is active", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const running = {
        ...assistantShell("existing-assistant", harness.root),
        activeRunId: RunId.make("run-1"),
      };
      yield* harness.addShell(running);
      yield* Effect.gen(function* () {
        const assistant = yield* AssistantService.AssistantService;
        yield* assistant.start();
        yield* assistant.writeMemory({ content: "# 助理記憶\n" });
        assert.equal(yield* Ref.get(harness.releaseCalls), 0);

        yield* harness.addShell({ ...running, activeRunId: null });
        yield* Queue.offer(harness.domainEvents, {
          type: "run.updated",
          threadId: running.id,
          payload: { status: "completed" },
        } as unknown as OrchestrationV2DomainEvent);
        assert.equal(yield* Deferred.await(harness.released), "session-1");
        assert.equal(yield* Ref.get(harness.releaseCalls), 1);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );
  it.effect(
    "maybeTriggerDraft should send one draft message with fixed ids when the first ordinary clocking of the day exists",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ clockings: [todaySegment] });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const sent = yield* awaitStoredDraft("2026-11-05", (d) => d.triggerRunId !== undefined);
          yield* assistant.getClockStatus();
          yield* Fiber.join(sent);
          assert.lengthOf(harness.sends, 1);
          const [send] = harness.sends;
          assert.equal(send?.commandId, "assistant-daily-draft:2026-11-05:1");
          assert.equal(send?.messageId, "assistant-daily-draft:2026-11-05:1");
          assert.equal(send?.mode, "queue");
          assert.equal(send?.notification?.summary, "今天第一次打卡，助理開始擬日報草稿");
          assert.include(send?.text, "prefill: yesterday | finished | Example | Ship the release");
          const draft = yield* readStoredDraft("2026-11-05");
          assert.equal(draft?.status, "generating");
          assert.equal(draft?.triggerAttempt, 1);
          assert.equal(draft?.triggerRunId, "run-1");
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect.each([
    { reason: "exempt", today: todayReport({ daily_report_exempt: true }) },
    {
      reason: "submitted",
      today: todayReport({ report: { submitted_at: "2026-11-05T09:30:00+08:00" } }),
    },
  ])("maybeTriggerDraft should not send when the daily report is $reason", ({ today }) =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ clockings: [todaySegment], today });
      yield* Effect.gen(function* () {
        const assistant = yield* AssistantService.AssistantService;
        yield* assistant.getClockStatus();
        assert.lengthOf(harness.sends, 0);
        assert.isUndefined(yield* readStoredDraft("2026-11-05"));
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "maybeTriggerDraft should not send twice when getClockStatus is called again the same day",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ clockings: [todaySegment] });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const sent = yield* awaitStoredDraft("2026-11-05", (d) => d.triggerRunId !== undefined);
          yield* assistant.getClockStatus();
          yield* Fiber.join(sent);
          yield* assistant.getClockStatus();
          assert.lengthOf(harness.sends, 1);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect.each([
    { runStatus: "completed", failure: "no-proposal" },
    { runStatus: "failed", failure: "run-failed" },
  ])(
    "failure watcher should mark the draft failed with $failure when the trigger run is $runStatus",
    ({ runStatus, failure }) =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ clockings: [todaySegment] });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const store = yield* AssistantDraftStore.AssistantDraftStore;
          const sent = yield* awaitStoredDraft("2026-11-05", (d) => d.triggerRunId !== undefined);
          yield* assistant.getClockStatus();
          yield* Fiber.join(sent);
          yield* assistant.start();
          const failed = yield* store.changes.pipe(
            Stream.filter((file) => file.drafts["2026-11-05"]?.status === "failed"),
            Stream.runHead,
            Effect.forkChild({ startImmediately: true }),
          );
          const threadId = harness.sends[0]!.threadId;
          // A waiting run (approval) is not terminal and leaves the draft generating.
          yield* Queue.offer(harness.domainEvents, runUpdated(threadId, "run-1", "waiting"));
          yield* Queue.offer(harness.domainEvents, runUpdated(threadId, "run-1", runStatus));
          yield* Fiber.join(failed);
          const draft = yield* readStoredDraft("2026-11-05");
          assert.equal(draft?.status, "failed");
          assert.equal(draft?.failure, failure);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect("saveDraft should reject when revision is stale", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const assistant = yield* AssistantService.AssistantService;
        const seeded = yield* seedDraft(storedDraft());
        const input = { reportDate: "2026-11-05", items: [], problemText: "blocked" };
        const stale = yield* Effect.flip(
          assistant.saveDraft({ ...input, revision: seeded.revision + 1 }),
        );
        assert.equal(stale.reason, "stale-revision");
        const saved = yield* assistant.saveDraft({ ...input, revision: seeded.revision });
        assert.equal(saved.problemText, "blocked");
        assert.isTrue(saved.editedByUser);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect("submitDailyReport should reject when revision is stale", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const assistant = yield* AssistantService.AssistantService;
        const seeded = yield* seedDraft(storedDraft());
        const error = yield* Effect.flip(
          assistant.submitDailyReport({ reportDate: "2026-11-05", revision: seeded.revision + 1 }),
        );
        assert.equal(error.reason, "stale-revision");
        assert.lengthOf(harness.submitted, 0);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect("submitDailyReport should reject when the assistant run is active", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.addShell({
        ...assistantShell("existing-assistant", harness.root),
        activeRunId: RunId.make("run-active"),
      });
      yield* Effect.gen(function* () {
        const assistant = yield* AssistantService.AssistantService;
        const seeded = yield* seedDraft(storedDraft());
        const error = yield* Effect.flip(
          assistant.submitDailyReport({ reportDate: "2026-11-05", revision: seeded.revision }),
        );
        assert.equal(error.reason, "busy");
        assert.lengthOf(harness.submitted, 0);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "submitDailyReport should post project_other instead of project_id when the item has free text",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const item = {
            section: "today",
            content: "Plan the sprint",
            status: "new",
            projectId: 7,
            projectOther: null,
            sortOrder: 0,
          } as const;
          const seeded = yield* seedDraft(
            storedDraft({
              problemText: "  ",
              items: [
                { ...item, sortOrder: 4, projectOther: "Side work" },
                item,
                { ...item, section: "yesterday", projectId: null, sortOrder: 9 },
              ],
            }),
          );
          const result = yield* assistant.submitDailyReport({
            reportDate: "2026-11-05",
            revision: seeded.revision,
          });
          assert.deepEqual(harness.submitted, [
            {
              date: "2026-11-05",
              items: [
                {
                  section: "yesterday",
                  content: "Plan the sprint",
                  status: "new",
                  sort_order: 0,
                },
                {
                  section: "today",
                  project_id: 7,
                  content: "Plan the sprint",
                  status: "new",
                  sort_order: 0,
                },
                {
                  section: "today",
                  project_other: "Side work",
                  content: "Plan the sprint",
                  status: "new",
                  sort_order: 1,
                },
              ],
            },
          ]);
          assert.equal(result.status, "submitted");
          assert.isDefined(result.submittedAt);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect("regenerateDraft should send attempt 2 ids when called after a failure", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const assistant = yield* AssistantService.AssistantService;
        const seeded = yield* seedDraft(
          storedDraft({
            status: "failed",
            failure: "no-proposal",
            triggerRunId: RunId.make("run-0"),
          }),
        );
        const draft = yield* assistant.regenerateDraft({
          reportDate: "2026-11-05",
          revision: seeded.revision,
        });
        assert.lengthOf(harness.sends, 1);
        assert.equal(harness.sends[0]?.commandId, "assistant-daily-draft:2026-11-05:2");
        assert.equal(harness.sends[0]?.notification?.summary, "重新產生日報草稿");
        assert.equal(draft.status, "generating");
        assert.equal(draft.triggerAttempt, 2);
        assert.equal(draft.triggerRunId, "run-1");
        assert.isUndefined(draft.failure);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "getDailyReport should mark the stored draft submitted when ERP reports submitted_at",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          settings: { assistant: { erpBaseUrl: "https://erp.example.com" } },
          today: todayReport({ report: { submitted_at: "2026-11-05T18:00:00+08:00" } }),
        });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          yield* seedDraft(storedDraft());
          assert.deepEqual(yield* assistant.getDailyReport(), {
            reportDate: "2026-11-05",
            exempt: false,
            submittedAt: "2026-11-05T18:00:00+08:00",
            erpDailyReportUrl: "https://erp.example.com/profile/daily-report",
          });
          const draft = yield* readStoredDraft("2026-11-05");
          assert.equal(draft?.status, "submitted");
          assert.equal(draft?.submittedAt, "2026-11-05T18:00:00+08:00");
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );
  it.effect(
    "regenerateDraft should store the run id when the request is interrupted during the send",
    () =>
      Effect.gen(function* () {
        const sendGate = yield* makeGate;
        const harness = yield* makeHarness({ sendGate });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const seeded = yield* seedDraft(
            storedDraft({ status: "failed", failure: "no-proposal" }),
          );
          const request = yield* assistant
            .regenerateDraft({ reportDate: "2026-11-05", revision: seeded.revision })
            .pipe(Effect.forkChild);
          yield* Deferred.await(sendGate.started);
          const interrupted = yield* Fiber.interrupt(request).pipe(
            Effect.forkChild({ startImmediately: true }),
          );
          yield* Deferred.succeed(sendGate.release, undefined);
          yield* Fiber.join(interrupted);
          const draft = yield* readStoredDraft("2026-11-05");
          assert.equal(draft?.status, "generating");
          assert.equal(draft?.triggerRunId, "run-1");
          assert.lengthOf(harness.sends, 1);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "maybeTriggerDraft should store a failed draft with thread-unavailable when the assistant thread cannot be created",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ clockings: [todaySegment], scratchUnavailable: true });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const failed = yield* awaitStoredDraft("2026-11-05", (d) => d.status === "failed");
          yield* assistant.getClockStatus();
          yield* Fiber.join(failed);
          assert.lengthOf(harness.sends, 0);
          const draft = yield* readStoredDraft("2026-11-05");
          assert.equal(draft?.status, "failed");
          assert.equal(draft?.failure, "thread-unavailable");
          assert.equal(draft?.triggerAttempt, 1);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "start should mark a generating draft failed when the server stopped before its message was sent",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const store = yield* AssistantDraftStore.AssistantDraftStore;
          yield* seedDraft(storedDraft({ status: "generating" }));
          const failed = yield* store.changes.pipe(
            Stream.filter((file) => file.drafts["2026-11-05"]?.status === "failed"),
            Stream.runHead,
            Effect.forkChild({ startImmediately: true }),
          );
          yield* assistant.start();
          yield* Fiber.join(failed);
          assert.equal((yield* readStoredDraft("2026-11-05"))?.failure, "thread-unavailable");
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "submitDailyReport should mark the draft submitted and fail with submitted when ERP already has the report",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          today: todayReport({ report: { submitted_at: "2026-11-05T17:00:00+08:00" } }),
        });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const seeded = yield* seedDraft(storedDraft());
          const error = yield* Effect.flip(
            assistant.submitDailyReport({ reportDate: "2026-11-05", revision: seeded.revision }),
          );
          assert.equal(error.reason, "submitted");
          assert.lengthOf(harness.submitted, 0);
          const draft = yield* readStoredDraft("2026-11-05");
          assert.equal(draft?.status, "submitted");
          assert.equal(draft?.submittedAt, "2026-11-05T17:00:00+08:00");
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "regenerateDraft should reject with not-editable when the draft is not for ERP's current day",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const seeded = yield* seedDraft(storedDraft({ reportDate: "2026-11-04" }));
          const error = yield* Effect.flip(
            assistant.regenerateDraft({ reportDate: "2026-11-04", revision: seeded.revision }),
          );
          assert.equal(error.reason, "not-editable");
          assert.lengthOf(harness.sends, 0);
          assert.equal((yield* readStoredDraft("2026-11-04"))?.status, "ready");
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect("streamState should push the stored drafts newest first when a client subscribes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const assistant = yield* AssistantService.AssistantService;
        yield* seedDraft(storedDraft({ reportDate: "2026-11-04" }));
        yield* seedDraft(storedDraft());
        const state = yield* assistant.streamState().pipe(Stream.runHead);
        assert.deepEqual(
          Option.getOrThrow(state).drafts.map((draft) => draft.reportDate),
          ["2026-11-05", "2026-11-04"],
        );
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );
  it.effect(
    "proposeDraft should fail with the no-trigger message when no draft has been triggered",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* harness.addShell(assistantShell("existing-assistant", harness.root));
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const error = yield* Effect.flip(
            assistant.proposeDraft({
              callerThreadId: ThreadId.make("existing-assistant"),
              items: [],
              problemText: "",
              sources: [{ key: "erp_prefill", status: "ok" }],
            }),
          );
          assert.equal(error.kind, "no-draft");
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "proposeDraft should bump version and reset editedByUser when the assistant proposes",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* harness.addShell(assistantShell("existing-assistant", harness.root));
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          yield* seedDraft(
            storedDraft({
              status: "failed",
              failure: "no-proposal",
              version: 1,
              editedByUser: true,
            }),
          );
          const saved = yield* assistant.proposeDraft({
            callerThreadId: ThreadId.make("existing-assistant"),
            items: [
              {
                section: "today",
                content: "  Plan the sprint  ",
                status: "new",
                projectId: 7,
                projectOther: null,
                sortOrder: 0,
              },
            ],
            problemText: "None",
            sources: [{ key: "calendar", status: "failed", note: "No calendar tool" }],
          });
          assert.deepEqual(saved, {
            reportDate: "2026-11-05",
            version: 2,
            fromEarlierWorkday: false,
          });
          const { draft } = yield* assistant.getDraftForAgent(ThreadId.make("existing-assistant"));
          assert.equal(draft.status, "ready");
          assert.isFalse(draft.editedByUser);
          assert.isUndefined(draft.failure);
          assert.equal(draft.items[0]?.content, "Plan the sprint");
          assert.equal(draft.sources[0]?.note, "No calendar tool");
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect("proposeDraft should reject when the caller thread is not the assistant thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.addShell(assistantShell("existing-assistant", harness.root));
      yield* Effect.gen(function* () {
        const assistant = yield* AssistantService.AssistantService;
        yield* seedDraft(storedDraft());
        const error = yield* Effect.flip(
          assistant.proposeDraft({
            callerThreadId: ThreadId.make("some-other-thread"),
            items: [],
            problemText: "",
            sources: [{ key: "erp_prefill", status: "ok" }],
          }),
        );
        assert.equal(error.kind, "not-assistant-thread");
        assert.equal((yield* readStoredDraft("2026-11-05"))?.version, 1);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "proposeDraft should reject with stale when the user saved the card after the agent read the draft",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* harness.addShell(assistantShell("existing-assistant", harness.root));
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const callerThreadId = ThreadId.make("existing-assistant");
          const item = {
            section: "today",
            content: "Typo itme",
            status: "new",
            projectId: 7,
            projectOther: null,
            sortOrder: 0,
          } as const;
          yield* seedDraft(storedDraft({ items: [item] }));
          const { draft: read } = yield* assistant.getDraftForAgent(callerThreadId);
          yield* assistant.saveDraft({
            reportDate: "2026-11-05",
            revision: read.revision,
            items: [{ ...item, content: "Fixed item" }],
            problemText: "",
          });
          const proposal = {
            callerThreadId,
            items: [{ ...item, status: "processing" as const }],
            problemText: "",
            sources: [{ key: "erp_prefill" as const, status: "ok" as const }],
          };
          const error = yield* Effect.flip(assistant.proposeDraft(proposal));
          assert.equal(error.kind, "stale");
          const kept = yield* readStoredDraft("2026-11-05");
          assert.equal(kept?.items[0]?.content, "Fixed item");
          assert.equal(kept?.version, 1);

          const { draft: reread } = yield* assistant.getDraftForAgent(callerThreadId);
          const revised = {
            ...proposal,
            items: reread.items.map((current) => ({ ...current, status: "processing" as const })),
          };
          assert.equal((yield* assistant.proposeDraft(revised)).version, 2);
          // The agent knows the version it wrote, so it may revise again without re-reading.
          assert.equal((yield* assistant.proposeDraft(revised)).version, 3);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "getClockStatus should reply with the draft already generating when the first clocking triggers a draft whose message is still being prepared",
    () =>
      Effect.gen(function* () {
        const projectsGate = yield* makeGate;
        const harness = yield* makeHarness({ clockings: [todaySegment], projectsGate });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const sent = yield* awaitStoredDraft("2026-11-05", (d) => d.triggerRunId !== undefined);
          const status = yield* assistant.getClockStatus();
          assert.lengthOf(status.segments, 1);
          assert.equal((yield* readStoredDraft("2026-11-05"))?.status, "generating");
          yield* Deferred.await(projectsGate.started);
          assert.lengthOf(harness.sends, 0);
          yield* Deferred.succeed(projectsGate.release, undefined);
          yield* Fiber.join(sent);
          assert.lengthOf(harness.sends, 1);
          assert.equal((yield* readStoredDraft("2026-11-05"))?.triggerAttempt, 1);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "getClockStatus should reply to a concurrent request while the first one's draft is still being prepared when both find no draft",
    () =>
      Effect.gen(function* () {
        const projectsGate = yield* makeGate;
        const todayGate = {
          arrived: yield* Queue.unbounded<void>(),
          release: yield* Deferred.make<void>(),
        };
        const harness = yield* makeHarness({ clockings: [todaySegment], projectsGate, todayGate });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const sent = yield* awaitStoredDraft("2026-11-05", (d) => d.triggerRunId !== undefined);
          const first = yield* assistant.getClockStatus().pipe(Effect.forkChild);
          const second = yield* assistant.getClockStatus().pipe(Effect.forkChild);
          // Both requests passed the no-draft check before either stored the generating draft.
          yield* Queue.take(todayGate.arrived);
          yield* Queue.take(todayGate.arrived);
          yield* Deferred.succeed(todayGate.release, undefined);
          yield* Deferred.await(projectsGate.started);
          assert.lengthOf((yield* Fiber.join(first)).segments, 1);
          assert.lengthOf((yield* Fiber.join(second)).segments, 1);
          assert.equal((yield* readStoredDraft("2026-11-05"))?.status, "generating");
          assert.lengthOf(harness.sends, 0);
          yield* Deferred.succeed(projectsGate.release, undefined);
          yield* Fiber.join(sent);
          assert.lengthOf(harness.sends, 1);
          assert.equal((yield* readStoredDraft("2026-11-05"))?.triggerAttempt, 1);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "getDraftForAgent should keep the last triggered draft and flag it as an earlier workday when the clock moves to the next day",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          active: activeClocking({
            meta: {
              server_now: "2026-11-06T00:30:00+08:00",
              today_ordinary_hours: 0,
              today_required_hours: 8,
            },
          }),
        });
        yield* harness.addShell(assistantShell("existing-assistant", harness.root));
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const callerThreadId = ThreadId.make("existing-assistant");
          yield* TestClock.setTime(
            DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-06T00:30:00+08:00")),
          );
          yield* seedDraft(storedDraft({ reportDate: "2026-11-04", status: "submitted" }));
          yield* seedDraft(storedDraft());
          assert.equal((yield* assistant.getClockStatus()).reportDate, "2026-11-06");
          const read = yield* assistant.getDraftForAgent(callerThreadId);
          assert.equal(read.draft.reportDate, "2026-11-05");
          assert.isTrue(read.fromEarlierWorkday);
          const saved = yield* assistant.proposeDraft({
            callerThreadId,
            items: [],
            problemText: "",
            sources: [{ key: "erp_prefill", status: "ok" }],
          });
          assert.deepEqual(saved, {
            reportDate: "2026-11-05",
            version: 2,
            fromEarlierWorkday: true,
          });

          yield* seedDraft(storedDraft({ reportDate: "2026-11-06", status: "generating" }));
          const next = yield* assistant.getDraftForAgent(callerThreadId);
          assert.equal(next.draft.reportDate, "2026-11-06");
          assert.isFalse(next.fromEarlierWorkday);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "getDraftForAgent should treat the ERP workday as today when the user is still clocked in past midnight",
    () =>
      Effect.gen(function* () {
        const lateSegment = {
          ...todaySegment,
          start_time: "2026-11-05T22:00:00+08:00",
        } satisfies ErpClient.ErpClocking;
        const harness = yield* makeHarness({
          active: activeClocking({
            data: lateSegment,
            meta: {
              server_now: "2026-11-06T00:30:00+08:00",
              today_ordinary_hours: 0,
              today_required_hours: 8,
            },
          }),
          clockings: [lateSegment],
        });
        yield* harness.addShell(assistantShell("existing-assistant", harness.root));
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const callerThreadId = ThreadId.make("existing-assistant");
          yield* TestClock.setTime(
            DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-06T00:30:00+08:00")),
          );
          yield* seedDraft(storedDraft());
          assert.equal((yield* assistant.getClockStatus()).reportDate, "2026-11-05");
          assert.isFalse((yield* assistant.getDraftForAgent(callerThreadId)).fromEarlierWorkday);
          const saved = yield* assistant.proposeDraft({
            callerThreadId,
            items: [],
            problemText: "",
            sources: [{ key: "erp_prefill", status: "ok" }],
          });
          assert.isFalse(saved.fromEarlierWorkday);

          yield* seedDraft(storedDraft({ status: "submitted" }));
          const submitted = yield* Effect.flip(assistant.getDraftForAgent(callerThreadId));
          assert.equal(submitted.kind, "submitted");
          assert.equal(submitted.reportDate, "2026-11-05");

          // A clock read from an earlier date says nothing about today.
          yield* TestClock.setTime(
            DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-07T08:30:00+08:00")),
          );
          const nextDay = yield* Effect.flip(assistant.getDraftForAgent(callerThreadId));
          assert.equal(nextDay.kind, "no-draft");
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "proposeDraft should reject an earlier workday's draft when the agent has not read it since the day changed or since its last write",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* harness.addShell(assistantShell("existing-assistant", harness.root));
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const callerThreadId = ThreadId.make("existing-assistant");
          const proposal = {
            callerThreadId,
            items: [
              {
                section: "today",
                content: "Plan for 11/06",
                status: "new",
                projectId: 7,
                projectOther: null,
                sortOrder: 0,
              },
            ],
            problemText: "",
            sources: [{ key: "erp_prefill", status: "ok" }],
          } as const;
          yield* TestClock.setTime(
            DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-05T20:00:00+08:00")),
          );
          yield* seedDraft(storedDraft());
          yield* assistant.getDraftForAgent(callerThreadId);

          yield* TestClock.setTime(
            DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-06T08:30:00+08:00")),
          );
          const unread = yield* Effect.flip(assistant.proposeDraft(proposal));
          assert.equal(unread.kind, "unread-earlier-workday");
          assert.equal(unread.reportDate, "2026-11-05");
          assert.lengthOf((yield* readStoredDraft("2026-11-05"))?.items ?? [], 0);

          assert.isTrue((yield* assistant.getDraftForAgent(callerThreadId)).fromEarlierWorkday);
          assert.equal((yield* assistant.proposeDraft(proposal)).version, 2);
          const unreadAfterWrite = yield* Effect.flip(assistant.proposeDraft(proposal));
          assert.equal(unreadAfterWrite.kind, "unread-earlier-workday");
          assert.equal((yield* readStoredDraft("2026-11-05"))?.version, 2);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect.each([
    { now: "2026-11-06T08:30:00+08:00", kind: "no-draft", reportDate: undefined },
    { now: "2026-11-05T20:00:00+08:00", kind: "submitted", reportDate: "2026-11-05" },
  ])(
    "getDraftForAgent and proposeDraft should reject with $kind when the newest draft is submitted and the clock reads $now",
    ({ now, kind, reportDate }) =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* harness.addShell(assistantShell("existing-assistant", harness.root));
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const callerThreadId = ThreadId.make("existing-assistant");
          yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(now)));
          yield* seedDraft(storedDraft({ status: "submitted" }));
          const read = yield* Effect.flip(assistant.getDraftForAgent(callerThreadId));
          assert.equal(read.kind, kind);
          assert.equal(read.reportDate, reportDate);
          const proposed = yield* Effect.flip(
            assistant.proposeDraft({
              callerThreadId,
              items: [],
              problemText: "",
              sources: [{ key: "erp_prefill", status: "ok" }],
            }),
          );
          assert.equal(proposed.kind, kind);
          assert.equal((yield* readStoredDraft("2026-11-05"))?.status, "submitted");
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect("submitDailyReport should reject with not-editable when every item is blank", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const assistant = yield* AssistantService.AssistantService;
        const seeded = yield* seedDraft(
          storedDraft({
            items: [
              {
                section: "today",
                content: " \n",
                status: "new",
                projectId: 7,
                projectOther: null,
                sortOrder: 0,
              },
            ],
          }),
        );
        const error = yield* Effect.flip(
          assistant.submitDailyReport({ reportDate: "2026-11-05", revision: seeded.revision }),
        );
        assert.equal(error.reason, "not-editable");
        assert.lengthOf(harness.submitted, 0);
        assert.equal((yield* readStoredDraft("2026-11-05"))?.status, "ready");
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "submitDailyReport should skip blank items and send no project when the other project name is blank",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          const item = {
            section: "today",
            content: "Plan the sprint",
            status: "new",
            projectId: null,
            projectOther: "  ",
            sortOrder: 1,
          } as const;
          const seeded = yield* seedDraft(
            storedDraft({
              items: [
                { ...item, content: " \n", projectId: 7, projectOther: null, sortOrder: 0 },
                item,
              ],
            }),
          );
          yield* assistant.submitDailyReport({
            reportDate: "2026-11-05",
            revision: seeded.revision,
          });
          assert.deepEqual(harness.submitted, [
            {
              date: "2026-11-05",
              items: [
                { section: "today", content: "Plan the sprint", status: "new", sort_order: 0 },
              ],
            },
          ]);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );

  it.effect.each([
    { erp: "has no submitted report", fails: false, status: "ready" },
    { erp: "cannot be read", fails: true, status: "submitted" },
  ])(
    "getDailyReport should leave the cached submitted draft $status when ERP $erp",
    ({ fails, status }) =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        if (fails) harness.erpState.todayFailure = new AssistantError({ reason: "unavailable" });
        yield* Effect.gen(function* () {
          const assistant = yield* AssistantService.AssistantService;
          yield* seedDraft(
            storedDraft({ status: "submitted", submittedAt: "2026-11-05T18:00:00+08:00" }),
          );
          yield* assistant.getDailyReport().pipe(Effect.ignore);
          const draft = yield* readStoredDraft("2026-11-05");
          assert.equal(draft?.status, status);
          assert.equal(draft?.submittedAt === undefined, !fails);
        }).pipe(Effect.provide(harness.layer));
      }).pipe(Effect.scoped),
  );
});
