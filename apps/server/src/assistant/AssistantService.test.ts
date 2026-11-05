import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
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
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

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

interface HarnessOptions {
  readonly active?: ErpClient.ErpActiveClocking;
  readonly clockings?: ReadonlyArray<ErpClient.ErpClocking>;
  readonly settings?: Parameters<typeof ServerSettings.layerTest>[0];
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
      })) as unknown as ThreadManagement.ThreadManagementService["Service"]["getThreadRecords"],
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
    ensureScratchProject: Effect.succeed({ projectId: SCRATCH }),
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
    listProjects: () => Effect.succeed([{ id: 7, name: "Example" }]),
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
          const drafts = yield* AssistantDraftStore.AssistantDraftStore;
          assert.equal((yield* drafts.read()).workday, "2026-11-05");
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
});
