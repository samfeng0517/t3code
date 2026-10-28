import { CommandId, type ServerSettings as ContractServerSettings } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

type CleanupKind = "archive" | "delete";

function cleanupAfterDays(settings: ContractServerSettings, kind: CleanupKind): number | null {
  return kind === "archive"
    ? settings.sidebarAutoArchiveSettledAfterDays
    : settings.sidebarAutoDeleteArchivedAfterDays;
}

/**
 * Archives threads that stayed settled past the configured age, then deletes
 * threads it archived itself once they stay archived past theirs. Ages come
 * from persisted timestamps, so a restart only delays the next sweep. Bound
 * automations and subagent threads are never touched.
 */
export class ThreadAutoCleanupServiceV2 extends Context.Service<
  ThreadAutoCleanupServiceV2,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ThreadAutoCleanupService/ThreadAutoCleanupServiceV2") {}

export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;

  const cleanUpThread = Effect.fn("ThreadAutoCleanupServiceV2.cleanUpThread")(
    function* (
      kind: CleanupKind,
      afterDays: number,
      candidate: ProjectionStore.ProjectionThreadCleanupCandidate,
    ) {
      // A setting turned off or changed mid-sweep stops the remaining work at once.
      if (cleanupAfterDays(yield* settingsService.getSettings, kind) !== afterDays) return;
      const uuid = yield* crypto.randomUUIDv4();
      yield* orchestrator.dispatch({
        type: kind === "archive" ? "thread.auto-archive" : "thread.auto-delete",
        commandId: CommandId.make(`server:auto-${kind}:${candidate.threadId}:${uuid}`),
        threadId: candidate.threadId,
        snapshotAt: candidate.updatedAt,
      });
    },
    (effect, kind, _afterDays, candidate) =>
      effect.pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning(`automatic thread ${kind} skipped`, {
              threadId: candidate.threadId,
              cause: Cause.pretty(cause),
            }),
        ),
      ),
  );

  const sweep = Effect.fn("ThreadAutoCleanupServiceV2.sweep")(function* () {
    const settings = yield* settingsService.getSettings;
    const now = yield* DateTime.now;
    const archiveAfterDays = cleanupAfterDays(settings, "archive");
    if (archiveAfterDays !== null) {
      const candidates = yield* projections.getAutoArchiveCandidates({
        settledBefore: DateTime.subtract(now, { days: archiveAfterDays }),
      });
      yield* Effect.forEach(
        candidates,
        (candidate) => cleanUpThread("archive", archiveAfterDays, candidate),
        { discard: true },
      );
    }
    const deleteAfterDays = cleanupAfterDays(settings, "delete");
    if (deleteAfterDays !== null) {
      const candidates = yield* projections.getAutoDeleteCandidates({
        archivedBefore: DateTime.subtract(now, { days: deleteAfterDays }),
      });
      yield* Effect.forEach(
        candidates,
        (candidate) => cleanUpThread("delete", deleteAfterDays, candidate),
        { discard: true },
      );
    }
  });

  const worker = yield* makeDrainableWorker(() =>
    sweep().pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          Effect.logWarning("automatic thread cleanup sweep failed", {
            cause: Cause.pretty(cause),
          }),
      ),
    ),
  );

  const start: ThreadAutoCleanupServiceV2["Service"]["start"] = Effect.fn(
    "ThreadAutoCleanupServiceV2.start",
  )(function* () {
    // Hourly is plenty for day-scale ages. Settings changes deliberately do not trigger a sweep:
    // a half-typed day count must never act on threads. Waiting for each sweep before the next
    // keeps a slow sweep from piling up behind itself.
    yield* forkParked(
      worker
        .enqueue(undefined)
        .pipe(Effect.andThen(Effect.sleep("1 hour")), Effect.andThen(worker.drain), Effect.forever),
    );
  });

  return { start, drain: worker.drain } satisfies ThreadAutoCleanupServiceV2["Service"];
});

export const layer = Layer.effect(ThreadAutoCleanupServiceV2, make);
