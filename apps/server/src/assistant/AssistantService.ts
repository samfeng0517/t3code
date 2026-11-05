import {
  type AssistantClockStatus,
  AssistantError,
  type AssistantMemory,
  type AssistantProject,
  type AssistantSettings,
  CommandId,
  DEFAULT_ASSISTANT_MODEL_SELECTION,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ModelSelection,
  type OrchestrationV2DomainEvent,
  type ProviderSessionId,
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
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AssistantDraftStore from "./AssistantDraftStore.ts";
import { DEFAULT_ASSISTANT_MEMORY } from "./assistantMemory.ts";
import * as ErpClient from "./ErpClient.ts";

const MEMORY_FILE = "CLAUDE.md";
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

  const cachedThreadId = yield* Ref.make<ThreadId | null>(null);
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
    const cached = yield* Ref.get(cachedThreadId);
    if (cached !== null) {
      if ((yield* liveShell(cached)) !== null) return cached;
      yield* Ref.set(cachedThreadId, null);
    }
    // Archived assistant threads count too: archiving must not fork the chat or reset its memory.
    const candidates = yield* threads
      .listAssistantThreadIds()
      .pipe(Effect.mapError(threadUnavailable));
    for (const threadId of candidates) {
      const shell = yield* liveShell(threadId);
      if (shell === null || !(yield* managedFolders.isScratchProject(shell.projectId))) continue;
      yield* Ref.set(cachedThreadId, threadId);
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
    yield* Ref.set(cachedThreadId, launched.threadId);
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

  const getClockStatus = Effect.fn("AssistantService.getClockStatus")(function* () {
    const active = yield* erp.getActiveClocking();
    const workday = active.data?.date ?? taipeiDate(active.meta.server_now);
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
    const stored = yield* drafts.read().pipe(
      Effect.tapError((cause) => Effect.logWarning("assistant drafts were not read", { cause })),
      Effect.option,
    );
    if (stored._tag === "Some" && stored.value.workday !== workday) {
      yield* drafts
        .update((file) => [undefined, { ...file, workday }])
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("assistant workday was not persisted", { cause }),
          ),
        );
    }
    return {
      reportDate: workday,
      serverNow: active.meta.server_now,
      segments,
      activeStart,
      completedHours,
      requiredHours,
      expectedEnd: expectedEndOf(activeStart, requiredHours, completedHours),
    } satisfies AssistantClockStatus;
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
    if (event.type !== "run.updated" || !TERMINAL_RUN_STATUSES.has(event.payload.status)) return;
    if (event.threadId !== (yield* Ref.get(cachedThreadId))) return;
    if (!(yield* Ref.getAndSet(memoryReloadPending, false))) return;
    yield* releaseSessions(event.threadId).pipe(Effect.ignore({ log: true }));
  });

  const start = Effect.fn("AssistantService.start")(function* () {
    yield* forkParked(watchSettings);
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
    start,
  });
});

export const layer = Layer.effect(AssistantService, make);
