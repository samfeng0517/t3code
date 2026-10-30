import {
  ModSurfaceActionError,
  ProviderDriverKind,
  ProviderSessionId,
  ThreadId,
  type ModSurfaceActInput,
  type ModSurfaceActResult,
} from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ModSurfaceActions from "./ModSurfaceActions.ts";
import * as ModSurfaceHub from "./ModSurfaceHub.ts";

const threadId = ThreadId.make("thread-mod-actions");
const providerSessionId = ProviderSessionId.make("provider-session-mod-actions");
const PRESS = {
  threadId,
  action: { type: "close-pane", paneId: "demo-pane" },
} as const;

/** A live session whose mods answer every action with `answer`. */
function actWith(
  answer: Effect.Effect<ModSurfaceActResult, ProviderAdapter.ProviderAdapterV2Error>,
  seen: Array<ModSurfaceActInput> = [],
) {
  const runtime = {
    providerSessionId,
    mods: {
      act: (input: ModSurfaceActInput) => {
        seen.push(input);
        return answer;
      },
    },
  } as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime;
  const layer = ModSurfaceActions.layer.pipe(
    Layer.provideMerge(ModSurfaceHub.layer),
    Layer.provide(
      Layer.succeed(
        ProviderSessionManager.ProviderSessionManagerV2,
        ProviderSessionManager.ProviderSessionManagerV2.of({
          shutdown: Effect.void,
          open: () => Effect.die("unused open"),
          get: () => Effect.succeedSome(runtime),
          isLive: () => Effect.succeed(true),
          close: () => Effect.void,
          closeInstance: () => Effect.void,
          release: () => Effect.void,
          releaseUnlessBusy: () => Effect.succeed(true),
          otherWorkingThreads: () => Effect.succeed([]),
          detach: () => Effect.void,
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const hub = yield* ModSurfaceHub.ModSurfaceHub;
    yield* hub.publish({
      providerSessionId,
      threadId,
      event: { type: "reset", availability: "available" },
    });
    return yield* ModSurfaceActions.ModSurfaceActions;
  }).pipe(Effect.provide(layer));
}

describe("ModSurfaceActions", () => {
  it.effect("hands a field's text to the session that drew it, as the client sent it", () =>
    Effect.gen(function* () {
      const seen: Array<ModSurfaceActInput> = [];
      const actions = yield* actWith(Effect.succeed({ handled: true }), seen);
      const edit = {
        threadId,
        action: {
          type: "input",
          site: { component: "AbovePrompt" },
          plugin: "notes",
          handle: 3,
          key: "note",
          kind: "submit",
          value: "ship it",
        },
      } as const;
      assert.deepStrictEqual(yield* actions.act(edit), { handled: true });
      assert.deepStrictEqual(seen, [edit]);
    }),
  );

  it.effect("reports a session whose process no longer serves the thread as stopped", () =>
    Effect.gen(function* () {
      const actions = yield* actWith(
        Effect.fail(
          new ProviderAdapter.ProviderAdapterProtocolError({
            driver: ProviderDriverKind.make("claudeAgent"),
            detail: "No live Claude Code process drew this mod.",
            cause: new ModSurfaceActionError({ threadId, reason: "session-stopped" }),
          }),
        ),
      );
      const error = yield* Effect.flip(actions.act(PRESS));
      assert.strictEqual(error.reason, "session-stopped");
    }),
  );

  it.effect("reports a refused action as failed", () =>
    Effect.gen(function* () {
      const actions = yield* actWith(
        Effect.fail(
          new ProviderAdapter.ProviderAdapterProtocolError({
            driver: ProviderDriverKind.make("claudeAgent"),
            detail: "Claude Code did not answer the mod action.",
          }),
        ),
      );
      const error = yield* Effect.flip(actions.act(PRESS));
      assert.strictEqual(error.reason, "request-failed");
    }),
  );

  it.effect("gives up on a mod that never answers, and cancels its request", () =>
    Effect.gen(function* () {
      let cancelled = false;
      const actions = yield* actWith(
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              cancelled = true;
            }),
          ),
        ),
      );
      const fiber = yield* actions.act(PRESS).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust("30 seconds");
      const error = yield* Fiber.join(fiber);
      assert.strictEqual(error.reason, "request-failed");
      assert.isTrue(cancelled);
    }),
  );
});
