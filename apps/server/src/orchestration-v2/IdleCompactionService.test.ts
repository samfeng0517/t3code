import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2ServerCommand,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as IdleCompactionService from "./IdleCompactionService.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const NOW_MS = Date.parse("2026-10-20T12:00:00.000Z");
const MINUTE_MS = 60_000;
const at = (offsetMs: number) => DateTime.makeUnsafe(NOW_MS + offsetMs);

/** Seeds an idle Claude thread whose last run completed five minutes ago. */
const seedIdleThread = Effect.fn("seedIdleThread")(function* (input: {
  readonly name: string;
  readonly instanceId: ProviderInstanceId;
  readonly cacheExpiresInMs: number;
}) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const threadId = ThreadId.make(`thread:${input.name}`);
  const runId = RunId.make(`run:${input.name}`);
  const messageId = MessageId.make(`message:${input.name}`);
  const nodeId = NodeId.make(`node:${input.name}`);
  const providerThreadId = ProviderThreadId.make(`provider-thread:${input.name}`);
  const modelSelection = { instanceId: input.instanceId, model: "claude-opus-5-5" };
  const completedAt = at(-5 * MINUTE_MS);
  const base = { threadId, occurredAt: completedAt };
  yield* store.apply({
    ...base,
    id: EventId.make(`event:${input.name}:thread`),
    type: "thread.created",
    payload: {
      id: threadId,
      projectId: ProjectId.make("project:idle-compaction"),
      title: input.name,
      createdBy: "user",
      creationSource: "web",
      providerInstanceId: input.instanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: providerThreadId,
      lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
      forkedFrom: null,
      createdAt: at(-60 * MINUTE_MS),
      updatedAt: completedAt,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
  yield* store.apply({
    ...base,
    id: EventId.make(`event:${input.name}:provider-thread`),
    type: "provider-thread.updated",
    payload: {
      id: providerThreadId,
      driver: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: input.instanceId,
      providerSessionId: null,
      appThreadId: threadId,
      ownerNodeId: nodeId,
      nativeThreadRef: null,
      nativeConversationHeadRef: null,
      status: "idle",
      firstRunOrdinal: 1,
      lastRunOrdinal: 1,
      handoffIds: [],
      forkedFrom: null,
      pendingBackgroundTasks: [],
      createdAt: at(-60 * MINUTE_MS),
      updatedAt: completedAt,
    },
  });
  yield* store.apply({
    ...base,
    id: EventId.make(`event:${input.name}:run`),
    type: "run.created",
    payload: {
      id: runId,
      threadId,
      ordinal: 1,
      providerInstanceId: input.instanceId,
      modelSelection,
      providerThreadId,
      userMessageId: messageId,
      rootNodeId: nodeId,
      activeAttemptId: null,
      status: "completed",
      requestedAt: at(-10 * MINUTE_MS),
      startedAt: at(-10 * MINUTE_MS),
      completedAt,
      checkpointId: null,
      contextHandoffId: null,
    },
  });
  yield* store.apply({
    ...base,
    id: EventId.make(`event:${input.name}:message`),
    type: "message.updated",
    payload: {
      id: messageId,
      threadId,
      runId,
      nodeId,
      role: "user",
      text: "Explain this code",
      attachments: [],
      streaming: false,
      createdBy: "user",
      creationSource: "web",
      createdAt: at(-10 * MINUTE_MS),
      updatedAt: at(-10 * MINUTE_MS),
    },
  });
  yield* store.apply({
    ...base,
    id: EventId.make(`event:${input.name}:provider-turn`),
    type: "provider-turn.updated",
    payload: {
      id: ProviderTurnId.make(`provider-turn:${input.name}`),
      providerThreadId,
      nodeId,
      runAttemptId: null,
      nativeTurnRef: null,
      ordinal: 1,
      status: "completed",
      startedAt: at(-10 * MINUTE_MS),
      completedAt,
      tokenUsage: {
        usedTokens: 250_000,
        promptCacheExpiresAt: DateTime.formatIso(at(input.cacheExpiresInMs)),
        updatedAt: DateTime.formatIso(completedAt),
      },
    },
  });
  return { threadId, runId };
});

const makeHarness = Effect.fn("makeIdleCompactionHarness")(function* () {
  const commands = yield* Queue.unbounded<OrchestrationV2ServerCommand>();
  const layerOrchestrator = Layer.mock(Orchestrator.OrchestratorV2)({
    // Only restart recovery is under test, so no live events arrive.
    streamDomainEvents: Stream.never,
    dispatch: (command) =>
      Queue.offer(commands, command).pipe(Effect.as({ sequence: 1, storedEvents: [] })),
  });
  return { commands, layerOrchestrator };
});

describe("IdleCompactionService", () => {
  it.effect(
    "should compact a thread recovered at start once its window opens when the default mode applies",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW_MS);
        const { commands, layerOrchestrator } = yield* makeHarness();
        yield* Effect.gen(function* () {
          const { threadId, runId } = yield* seedIdleThread({
            name: "recovered",
            instanceId: ProviderInstanceId.make("claudeAgent"),
            cacheExpiresInMs: 55 * MINUTE_MS,
          });
          const service = yield* IdleCompactionService.make;
          yield* service.start();

          // The window opens two minutes before the cache expires.
          yield* TestClock.adjust(53 * MINUTE_MS - 1);
          assert.equal(yield* Queue.size(commands), 0);
          yield* TestClock.adjust(1);
          const command = yield* Queue.take(commands);
          assert.deepInclude(command, {
            type: "message.dispatch",
            commandId: CommandId.make(`server:idle-compact:${threadId}:${runId}`),
            threadId,
            text: "/compact",
          });
          yield* TestClock.adjust(120 * MINUTE_MS);
          assert.equal(yield* Queue.size(commands), 0);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              layerOrchestrator,
              ProjectionStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory)),
              ServerSettings.layerTest(),
            ),
          ),
        );
      }),
  );

  it.effect(
    "should not compact a recovered thread when its provider resolves to compacting on return",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW_MS);
        const { commands, layerOrchestrator } = yield* makeHarness();
        const workInstanceId = ProviderInstanceId.make("claude_work");
        yield* Effect.gen(function* () {
          // Its window opens first, so a wrongly scheduled compaction would be taken first.
          yield* seedIdleThread({
            name: "on-return",
            instanceId: ProviderInstanceId.make("claudeAgent"),
            cacheExpiresInMs: 20 * MINUTE_MS,
          });
          const control = yield* seedIdleThread({
            name: "before-cache-expires",
            instanceId: workInstanceId,
            cacheExpiresInMs: 50 * MINUTE_MS,
          });
          const service = yield* IdleCompactionService.make;
          yield* service.start();

          yield* TestClock.adjust(60 * MINUTE_MS);
          const command = yield* Queue.take(commands);
          assert.deepInclude(command, { type: "message.dispatch", threadId: control.threadId });
          assert.equal(yield* Queue.size(commands), 0);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              layerOrchestrator,
              ProjectionStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory)),
              ServerSettings.layerTest({
                compactIdleThreads: "onReturn",
                providerInstances: {
                  [workInstanceId]: {
                    driver: ProviderDriverKind.make("claudeAgent"),
                    config: { idleCompaction: "beforeCacheExpires" },
                  },
                },
              }),
            ),
          ),
        );
      }),
  );
});
