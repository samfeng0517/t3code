import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const layerSql = ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));
const now = DateTime.makeUnsafe("2026-10-20T12:00:00Z");
const daysAgo = (days: number) => DateTime.subtract(now, { days });
const cutoff = daysAgo(30);
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-5.5" };

const createThread = Effect.fn(function* (
  name: string,
  overrides: Partial<OrchestrationV2AppThread> = {},
) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const threadId = ThreadId.make(`thread:auto-cleanup:${name}`);
  const updatedAt = overrides.updatedAt ?? daysAgo(40);
  yield* store.apply({
    id: EventId.make(`event:${threadId}`),
    type: "thread.created",
    threadId,
    occurredAt: updatedAt,
    payload: {
      createdBy: "user",
      creationSource: "web",
      id: threadId,
      projectId: ProjectId.make("project:auto-cleanup"),
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
      createdAt: daysAgo(60),
      updatedAt,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
      ...overrides,
    },
  });
  return { threadId, updatedAt };
});

const createRun = Effect.fn(function* (threadId: ThreadId, status: OrchestrationV2Run["status"]) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const runId = RunId.make(`run:${threadId}`);
  yield* store.apply({
    id: EventId.make(`event:${runId}`),
    type: "run.created",
    threadId,
    occurredAt: daysAgo(40),
    payload: {
      id: runId,
      threadId,
      ordinal: 1,
      providerInstanceId,
      modelSelection,
      providerThreadId: null,
      userMessageId: MessageId.make(`message:${runId}`),
      rootNodeId: null,
      activeAttemptId: null,
      status,
      requestedAt: daysAgo(40),
      startedAt: null,
      completedAt: null,
      checkpointId: null,
      contextHandoffId: null,
    },
  });
});

const createPendingRequest = Effect.fn(function* (threadId: ThreadId) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const nodeId = NodeId.make(`node:${threadId}`);
  yield* store.apply({
    id: EventId.make(`event:${threadId}:request`),
    type: "runtime-request.updated",
    threadId,
    nodeId,
    occurredAt: daysAgo(40),
    payload: {
      id: RuntimeRequestId.make(`request:${threadId}`),
      nodeId,
      providerTurnId: null,
      nativeRequestRef: null,
      kind: "user_input",
      status: "pending",
      responseCapability: { type: "message" },
      createdAt: daysAgo(40),
      resolvedAt: null,
    },
  });
});

// Subagent threads are hidden in the sidebar, so cleanup must never reach them.
const subagentLineage: OrchestrationV2AppThread["lineage"] = {
  rootThreadId: ThreadId.make("thread:auto-cleanup:parent"),
  parentThreadId: ThreadId.make("thread:auto-cleanup:parent"),
  relationshipToParent: "subagent",
};

const bindScheduledTask = Effect.fn(function* (threadId: ThreadId) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO scheduled_tasks (
      task_id, title, prompt, enabled, schedule_json, project_id, thread_id,
      workspace_strategy_json, model_selection_json, runtime_mode, interaction_mode,
      created_by, creation_source, created_at, updated_at, last_run_status, run_count
    ) VALUES (
      ${`task:${threadId}`}, 'Nightly', 'Run it', 1, '{}', 'project:auto-cleanup', ${threadId},
      '{}', '{}', 'full-access', 'default', 'user', 'web',
      ${DateTime.formatIso(daysAgo(60))}, ${DateTime.formatIso(daysAgo(60))}, 'never', 0
    )
  `;
});

const layers = [["sql", layerSql]] as const;

it.effect.each(layers)(
  "%s: getAutoArchiveCandidates should return idle settled threads when they settled before the cutoff",
  ([, testLayer]) =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const settled = { settledOverride: "settled" as const, settledAt: daysAgo(31) };
      const old = yield* createThread("old", settled);
      // Threads settled before settledAt existed fall back to their last update.
      const legacy = yield* createThread("legacy", {
        settledOverride: "settled",
        settledAt: null,
        updatedAt: daysAgo(35),
      });
      yield* createThread("recent", { settledOverride: "settled", settledAt: daysAgo(29) });
      // Auto-settle backdates settledAt to the last activity; the settle itself
      // (or any later change) is what updatedAt records.
      yield* createThread("touched", { ...settled, updatedAt: daysAgo(29) });
      yield* createThread("active", { settledAt: daysAgo(31) });
      yield* createThread("unsettled", { settledOverride: "active", settledAt: null });
      yield* createThread("pinned", { ...settled, pinnedAt: daysAgo(31) });
      yield* createThread("archived", { ...settled, archivedAt: daysAgo(31) });
      yield* createThread("deleted", { ...settled, deletedAt: daysAgo(31) });
      yield* createThread("subagent", { ...settled, lineage: subagentLineage });
      yield* createRun((yield* createThread("running", settled)).threadId, "running");
      yield* createRun((yield* createThread("queued", settled)).threadId, "queued");
      yield* createPendingRequest((yield* createThread("pending-request", settled)).threadId);
      const finished = yield* createThread("finished", settled);
      yield* createRun(finished.threadId, "completed");

      assert.deepEqual(
        yield* store.getAutoArchiveCandidates({ settledBefore: cutoff }),
        [finished, legacy, old].map(({ threadId, updatedAt }) => ({ threadId, updatedAt })),
      );
    }).pipe(Effect.provide(testLayer)),
);

it.effect.each(layers)(
  "%s: getAutoDeleteCandidates should return only auto-archived threads when they were archived before the cutoff",
  ([, testLayer]) =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const expired = yield* createThread("expired", {
        archivedAt: daysAgo(31),
        archivedBy: "auto",
      });
      yield* createThread("fresh", { archivedAt: daysAgo(29), archivedBy: "auto" });
      yield* createThread("manual", { archivedAt: daysAgo(90), archivedBy: "user" });
      yield* createThread("legacy", { archivedAt: daysAgo(90) });
      yield* createThread("unarchived", { archivedAt: null, archivedBy: null });
      yield* createThread("deleted", {
        archivedAt: daysAgo(31),
        archivedBy: "auto",
        deletedAt: daysAgo(1),
      });
      yield* createThread("subagent", {
        archivedAt: daysAgo(31),
        archivedBy: "auto",
        lineage: subagentLineage,
      });

      assert.deepEqual(yield* store.getAutoDeleteCandidates({ archivedBefore: cutoff }), [
        { threadId: expired.threadId, updatedAt: expired.updatedAt },
      ]);
    }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "sql: auto-cleanup candidates should skip threads when a scheduled task is bound to them",
  () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const settled = yield* createThread("settled-automation", {
        settledOverride: "settled",
        settledAt: daysAgo(31),
      });
      const archived = yield* createThread("archived-automation", {
        archivedAt: daysAgo(31),
        archivedBy: "auto",
      });
      assert.isFalse(yield* store.isBoundToScheduledTask(settled.threadId));
      yield* bindScheduledTask(settled.threadId);
      yield* bindScheduledTask(archived.threadId);

      assert.isTrue(yield* store.isBoundToScheduledTask(settled.threadId));
      assert.deepEqual(yield* store.getAutoArchiveCandidates({ settledBefore: cutoff }), []);
      assert.deepEqual(yield* store.getAutoDeleteCandidates({ archivedBefore: cutoff }), []);
    }).pipe(Effect.provide(layerSql)),
);
