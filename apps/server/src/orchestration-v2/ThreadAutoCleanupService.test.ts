import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ThreadId,
  type OrchestrationV2ServerCommand,
  type ServerSettings as ContractServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as ServerActivation from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadAutoCleanupService from "./ThreadAutoCleanupService.ts";

const NOW = DateTime.makeUnsafe("2026-10-20T12:00:00.000Z");

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(1),
  digest: (_algorithm, data) => Effect.succeed(data),
});

function candidate(name: string): ProjectionStore.ProjectionThreadCleanupCandidate {
  return {
    threadId: ThreadId.make(name),
    updatedAt: DateTime.subtract(NOW, { days: 40 }),
  };
}

interface CleanupRead {
  readonly kind: "archive" | "delete";
  readonly before: DateTime.Utc;
}

const makeHarness = Effect.fn("makeThreadAutoCleanupHarness")(function* (options: {
  readonly settings?: Partial<ContractServerSettings>;
  readonly archiveCandidates?: ReadonlyArray<ProjectionStore.ProjectionThreadCleanupCandidate>;
  readonly deleteCandidates?: ReadonlyArray<ProjectionStore.ProjectionThreadCleanupCandidate>;
  readonly onDispatch?: (
    command: OrchestrationV2ServerCommand,
    updateSettings: (patch: ServerSettingsPatch) => Effect.Effect<unknown>,
  ) => Effect.Effect<void>;
}) {
  const activation = yield* Deferred.make<void>();
  const settings = yield* Ref.make<ContractServerSettings>({
    ...DEFAULT_SERVER_SETTINGS,
    ...options.settings,
  });
  const settingsChanges = yield* PubSub.unbounded<ContractServerSettings>();
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
  const reads = yield* Ref.make<ReadonlyArray<CleanupRead>>([]);
  const readSignals = yield* Queue.unbounded<CleanupRead["kind"]>();

  const updateSettings = (patch: ServerSettingsPatch) =>
    Effect.gen(function* () {
      const next = applyServerSettingsPatch(yield* Ref.get(settings), patch);
      yield* Ref.set(settings, next);
      yield* PubSub.publish(settingsChanges, next);
      return next;
    });

  const serverSettings = ServerSettings.ServerSettingsService.of({
    start: Effect.void,
    ready: Effect.void,
    getSettings: Ref.get(settings),
    updateSettings,
    updateProviderInstance: () => Effect.die("Unexpected provider mutation"),
    withSettingsSnapshot: (use) => Ref.get(settings).pipe(Effect.flatMap(use)),
    streamChanges: Stream.fromPubSub(settingsChanges),
    subscribeChanges: PubSub.subscribe(settingsChanges).pipe(
      Effect.map((subscription) => Stream.fromSubscription(subscription)),
    ),
  });

  const layerDependencies = Layer.mergeAll(
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getAutoArchiveCandidates: ({ settledBefore }) =>
        Ref.update(reads, (current) => [
          ...current,
          { kind: "archive" as const, before: settledBefore },
        ]).pipe(
          Effect.andThen(Queue.offer(readSignals, "archive")),
          Effect.as(options.archiveCandidates ?? []),
        ),
      getAutoDeleteCandidates: ({ archivedBefore }) =>
        Ref.update(reads, (current) => [
          ...current,
          { kind: "delete" as const, before: archivedBefore },
        ]).pipe(
          Effect.andThen(Queue.offer(readSignals, "delete")),
          Effect.as(options.deleteCandidates ?? []),
        ),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      dispatch: (command) =>
        Ref.update(commands, (current) => [...current, command]).pipe(
          Effect.andThen(options.onDispatch?.(command, updateSettings) ?? Effect.void),
          Effect.as({ sequence: 1, storedEvents: [] }),
        ),
    }),
    Layer.succeed(ServerSettings.ServerSettingsService, serverSettings),
    Layer.succeed(ServerActivation.ServerActivation, Deferred.await(activation)),
    Layer.succeed(Crypto.Crypto, testCrypto),
  );

  return {
    activation,
    commands,
    reads,
    readSignals,
    updateSettings,
    layer: ThreadAutoCleanupService.layer.pipe(Layer.provide(layerDependencies)),
  };
});

type Harness = Effect.Success<ReturnType<typeof makeHarness>>;

/** Starts the service and waits for the sweep that runs on start to finish. */
const startAndSweep = Effect.fn("startThreadAutoCleanup")(function* (harness: Harness) {
  const service = yield* ThreadAutoCleanupService.ThreadAutoCleanupServiceV2;
  yield* service.start();
  yield* Deferred.succeed(harness.activation, undefined);
  yield* Queue.take(harness.readSignals);
  yield* service.drain;
  return service;
});

type CleanupCommand = Extract<
  OrchestrationV2ServerCommand,
  { readonly type: "thread.auto-archive" | "thread.auto-delete" }
>;

function cleanupCommands(
  commands: ReadonlyArray<OrchestrationV2ServerCommand>,
): ReadonlyArray<Pick<CleanupCommand, "type" | "threadId" | "snapshotAt">> {
  return commands.flatMap((command) =>
    command.type === "thread.auto-archive" || command.type === "thread.auto-delete"
      ? [{ type: command.type, threadId: command.threadId, snapshotAt: command.snapshotAt }]
      : [],
  );
}

describe("ThreadAutoCleanupServiceV2", () => {
  it.effect(
    "should archive settled threads and delete auto-archived threads when both cleanups are on",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(DateTime.toEpochMillis(NOW));
          const harness = yield* makeHarness({
            archiveCandidates: [candidate("settled")],
            deleteCandidates: [candidate("auto-archived")],
          });
          yield* Effect.gen(function* () {
            yield* startAndSweep(harness);
            assert.deepEqual(yield* Ref.get(harness.reads), [
              { kind: "archive", before: DateTime.subtract(NOW, { days: 30 }) },
              { kind: "delete", before: DateTime.subtract(NOW, { days: 30 }) },
            ]);
            assert.deepEqual(cleanupCommands(yield* Ref.get(harness.commands)), [
              {
                type: "thread.auto-archive",
                threadId: ThreadId.make("settled"),
                snapshotAt: candidate("settled").updatedAt,
              },
              {
                type: "thread.auto-delete",
                threadId: ThreadId.make("auto-archived"),
                snapshotAt: candidate("auto-archived").updatedAt,
              },
            ]);
          }).pipe(Effect.provide(harness.layer));
        }),
      ),
  );

  it.effect("should skip each cleanup when its setting is off", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(DateTime.toEpochMillis(NOW));
        const harness = yield* makeHarness({
          settings: {
            sidebarAutoArchiveSettledAfterDays: null,
            sidebarAutoDeleteArchivedAfterDays: 7,
          },
          archiveCandidates: [candidate("settled")],
          deleteCandidates: [candidate("auto-archived")],
        });
        yield* Effect.gen(function* () {
          yield* startAndSweep(harness);
          assert.deepEqual(yield* Ref.get(harness.reads), [
            { kind: "delete", before: DateTime.subtract(NOW, { days: 7 }) },
          ]);
          assert.deepEqual(
            (yield* Ref.get(harness.commands)).map((command) => command.type),
            ["thread.auto-delete"],
          );
        }).pipe(Effect.provide(harness.layer));
      }),
    ),
  );

  it.effect("should stop archiving mid-sweep when the setting turns off", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(DateTime.toEpochMillis(NOW));
        const harness = yield* makeHarness({
          settings: { sidebarAutoDeleteArchivedAfterDays: null },
          archiveCandidates: [candidate("first"), candidate("second")],
          onDispatch: (_command, updateSettings) =>
            updateSettings({ sidebarAutoArchiveSettledAfterDays: null }).pipe(Effect.asVoid),
        });
        yield* Effect.gen(function* () {
          yield* startAndSweep(harness);
          assert.deepEqual(
            cleanupCommands(yield* Ref.get(harness.commands)).map((command) => command.threadId),
            [ThreadId.make("first")],
          );
        }).pipe(Effect.provide(harness.layer));
      }),
    ),
  );

  it.effect("should sweep again when an hour passes after the last sweep", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(DateTime.toEpochMillis(NOW));
        const harness = yield* makeHarness({
          settings: { sidebarAutoDeleteArchivedAfterDays: null },
        });
        yield* Effect.gen(function* () {
          const service = yield* startAndSweep(harness);
          yield* TestClock.adjust("1 hour");
          yield* Queue.take(harness.readSignals);
          yield* service.drain;
          assert.deepEqual(yield* Ref.get(harness.reads), [
            { kind: "archive", before: DateTime.subtract(NOW, { days: 30 }) },
            {
              kind: "archive",
              before: DateTime.subtract(DateTime.add(NOW, { hours: 1 }), { days: 30 }),
            },
          ]);
        }).pipe(Effect.provide(harness.layer));
      }),
    ),
  );

  // Day inputs pass through smaller values while typing (30 → 3 → 35), so a
  // settings change must never act on threads before the hourly sweep.
  it.effect("should not sweep when the cleanup days change between hourly sweeps", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(DateTime.toEpochMillis(NOW));
        const harness = yield* makeHarness({
          settings: { sidebarAutoDeleteArchivedAfterDays: null },
          archiveCandidates: [candidate("settled")],
        });
        yield* Effect.gen(function* () {
          const service = yield* startAndSweep(harness);
          yield* harness.updateSettings({ sidebarAutoArchiveSettledAfterDays: 3 });
          yield* harness.updateSettings({ sidebarAutoArchiveSettledAfterDays: 35 });
          yield* service.drain;
          yield* TestClock.adjust("1 hour");
          yield* Queue.take(harness.readSignals);
          yield* service.drain;
          assert.deepEqual(yield* Ref.get(harness.reads), [
            { kind: "archive", before: DateTime.subtract(NOW, { days: 30 }) },
            {
              kind: "archive",
              before: DateTime.subtract(DateTime.add(NOW, { hours: 1 }), { days: 35 }),
            },
          ]);
        }).pipe(Effect.provide(harness.layer));
      }),
    ),
  );
});
