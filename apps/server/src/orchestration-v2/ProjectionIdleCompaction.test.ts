import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const layerSql = ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));
const now = DateTime.makeUnsafe("2026-10-20T12:00:00Z");
const cutoff = DateTime.subtract(now, { minutes: 60 });
const providerInstanceId = ProviderInstanceId.make("claudeAgent");
const modelSelection = { instanceId: providerInstanceId, model: "claude-opus-5-5" };

const createThread = Effect.fn(function* (
  name: string,
  overrides: Partial<OrchestrationV2AppThread> = {},
) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const threadId = ThreadId.make(`thread:idle-compaction:${name}`);
  yield* store.apply({
    id: EventId.make(`event:${threadId}`),
    type: "thread.created",
    threadId,
    occurredAt: now,
    payload: {
      createdBy: "user",
      creationSource: "web",
      id: threadId,
      projectId: ProjectId.make("project:idle-compaction"),
      title: name,
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
      ...overrides,
    },
  });
  return threadId;
});

const createRun = Effect.fn(function* (
  threadId: ThreadId,
  input: {
    readonly ordinal?: number;
    readonly status?: OrchestrationV2Run["status"];
    readonly completedMinutesAgo?: number;
  } = {},
) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const ordinal = input.ordinal ?? 1;
  const status = input.status ?? "completed";
  const runId = RunId.make(`run:${threadId}:${ordinal}`);
  const completedAt =
    status === "completed" || status === "failed"
      ? DateTime.subtract(now, { minutes: input.completedMinutesAgo ?? 10 })
      : null;
  yield* store.apply({
    id: EventId.make(`event:${runId}`),
    type: "run.created",
    threadId,
    occurredAt: now,
    payload: {
      id: runId,
      threadId,
      ordinal,
      providerInstanceId,
      modelSelection,
      providerThreadId: null,
      userMessageId: MessageId.make(`message:${runId}`),
      rootNodeId: null,
      activeAttemptId: null,
      status,
      requestedAt: DateTime.subtract(now, { hours: 2 }),
      startedAt: DateTime.subtract(now, { hours: 2 }),
      completedAt,
      checkpointId: null,
      contextHandoffId: null,
    },
  });
  return runId;
});

it.effect.each([
  ["sql", layerSql],
  ["memory", ProjectionStore.layerMemory],
] as const)(
  "%s: getIdleCompactionCandidates should return threads whose latest run completed after the cutoff",
  ([, testLayer]) =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const recent = yield* createThread("recent");
      const recentRun = yield* createRun(recent);
      const followUp = yield* createThread("follow-up");
      yield* createRun(followUp, { ordinal: 1, completedMinutesAgo: 30 });
      const followUpRun = yield* createRun(followUp, { ordinal: 2, completedMinutesAgo: 5 });
      yield* createRun(yield* createThread("expired"), { completedMinutesAgo: 61 });
      yield* createRun(yield* createThread("failed"), { status: "failed" });
      const running = yield* createThread("running");
      yield* createRun(running, { ordinal: 1 });
      yield* createRun(running, { ordinal: 2, status: "running" });
      const queued = yield* createThread("queued");
      yield* createRun(queued, { ordinal: 1 });
      yield* createRun(queued, { ordinal: 2, status: "queued" });
      yield* createRun(yield* createThread("archived", { archivedAt: now }));
      yield* createRun(yield* createThread("deleted", { deletedAt: now }));
      yield* createThread("never-ran");

      assert.deepEqual(yield* store.getIdleCompactionCandidates({ completedAfter: cutoff }), [
        { threadId: followUp, runId: followUpRun },
        { threadId: recent, runId: recentRun },
      ]);
    }).pipe(Effect.provide(testLayer)),
);
