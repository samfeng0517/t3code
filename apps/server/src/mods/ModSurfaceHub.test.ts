import { EMPTY_MOD_SURFACE_STATE, ProviderSessionId, ThreadId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import * as ModSurfaceHub from "./ModSurfaceHub.ts";

const threadId = ThreadId.make("thread-mods");
const providerSessionId = ProviderSessionId.make("provider-session-mods");
const nextProviderSessionId = ProviderSessionId.make("provider-session-mods-next");
const PANES = [{ id: "demo-pane", title: "Demo pane", plugin: "demo" }];

describe("ModSurfaceHub", () => {
  it.effect("serves what a thread's mods drew so far, then each change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hub = yield* ModSurfaceHub.make;
        yield* hub.publish({
          providerSessionId,
          threadId,
          event: { type: "reset", availability: "available" },
        });
        yield* hub.publish({ providerSessionId, threadId, event: { type: "panes", panes: PANES } });

        const pull = yield* Stream.toPull(hub.subscribe(threadId));
        const frames = [...(yield* pull)];
        yield* hub.publish({
          providerSessionId,
          threadId,
          event: { type: "status", plugin: "demo", text: "ready" },
        });
        yield* hub.releaseSession(providerSessionId);
        while (frames.length < 3) frames.push(...(yield* pull));

        assert.deepStrictEqual(frames, [
          {
            type: "snapshot",
            state: {
              ...EMPTY_MOD_SURFACE_STATE,
              availability: "available",
              panes: [{ ...PANES[0]!, tree: null }],
            },
          },
          { type: "status", plugin: "demo", text: "ready" },
          { type: "reset", availability: "inactive" },
        ]);
        assert.isUndefined(yield* hub.owner(threadId));
      }),
    ),
  );

  it.effect("names the session that drew a thread's mods", () =>
    Effect.gen(function* () {
      const hub = yield* ModSurfaceHub.make;
      assert.isUndefined(yield* hub.owner(threadId));
      yield* hub.publish({
        providerSessionId,
        threadId,
        event: { type: "reset", availability: "available" },
      });
      assert.strictEqual(yield* hub.owner(threadId), providerSessionId);
    }),
  );
  it.effect("a late reset from a non-owner is ignored", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hub = yield* ModSurfaceHub.make;
        yield* hub.publish({
          providerSessionId,
          threadId,
          event: { type: "reset", availability: "available" },
        });
        // A new process for the thread attaches, then the old one's end arrives.
        yield* hub.publish({
          providerSessionId: nextProviderSessionId,
          threadId,
          event: { type: "reset", availability: "available" },
        });
        yield* hub.publish({
          providerSessionId: nextProviderSessionId,
          threadId,
          event: { type: "panes", panes: PANES },
        });
        yield* hub.publish({
          providerSessionId,
          threadId,
          event: { type: "reset", availability: "inactive" },
        });
        yield* hub.publish({
          providerSessionId,
          threadId,
          event: { type: "status", plugin: "demo", text: "stale" },
        });

        const pull = yield* Stream.toPull(hub.subscribe(threadId));
        assert.deepStrictEqual(
          [...(yield* pull)],
          [
            {
              type: "snapshot",
              state: {
                ...EMPTY_MOD_SURFACE_STATE,
                availability: "available",
                panes: [{ ...PANES[0]!, tree: null }],
              },
            },
          ],
        );
        assert.strictEqual(yield* hub.owner(threadId), nextProviderSessionId);
      }),
    ),
  );

  it.effect("releaseSession of a former owner does not clear the new owner's state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hub = yield* ModSurfaceHub.make;
        yield* hub.publish({
          providerSessionId,
          threadId,
          event: { type: "reset", availability: "available" },
        });
        yield* hub.publish({
          providerSessionId: nextProviderSessionId,
          threadId,
          event: { type: "reset", availability: "available" },
        });
        yield* hub.publish({
          providerSessionId: nextProviderSessionId,
          threadId,
          event: { type: "panes", panes: PANES },
        });

        const pull = yield* Stream.toPull(hub.subscribe(threadId));
        const frames = [...(yield* pull)];
        // The former owner's process ends: its reset, then its release.
        yield* hub.publish({
          providerSessionId,
          threadId,
          event: { type: "reset", availability: "inactive" },
        });
        yield* hub.releaseSession(providerSessionId);
        yield* hub.publish({
          providerSessionId: nextProviderSessionId,
          threadId,
          event: { type: "status", plugin: "demo", text: "ready" },
        });
        while (frames.length < 2) frames.push(...(yield* pull));

        // The status is the next frame: the former owner's end sent nothing.
        assert.deepStrictEqual(frames[1], { type: "status", plugin: "demo", text: "ready" });
        assert.strictEqual(yield* hub.owner(threadId), nextProviderSessionId);
      }),
    ),
  );

  it.effect("drops the least recently changed thread beyond its limit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hub = yield* ModSurfaceHub.make;
        const threadIds = Array.from({ length: 257 }, (_, index) =>
          ThreadId.make(`thread-mods-${index}`),
        );
        yield* hub.publish({
          providerSessionId,
          threadId: threadIds[0]!,
          event: { type: "reset", availability: "available" },
        });
        const pull = yield* Stream.toPull(hub.subscribe(threadIds[0]!));
        const frames = [...(yield* pull)];
        for (const next of threadIds.slice(1)) {
          yield* hub.publish({
            providerSessionId,
            threadId: next,
            event: { type: "reset", availability: "available" },
          });
        }
        while (frames.length < 2) frames.push(...(yield* pull));

        assert.deepStrictEqual(frames[1], { type: "reset", availability: "inactive" });
        assert.isUndefined(yield* hub.owner(threadIds[0]!));
        assert.strictEqual(yield* hub.owner(threadIds[1]!), providerSessionId);
        assert.strictEqual(yield* hub.owner(threadIds[256]!), providerSessionId);
      }),
    ),
  );

  it.effect("sends a subscriber that fell far behind one snapshot instead of every change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hub = yield* ModSurfaceHub.make;
        yield* hub.publish({
          providerSessionId,
          threadId,
          event: { type: "reset", availability: "available" },
        });
        const pull = yield* Stream.toPull(hub.subscribe(threadId));
        yield* pull;
        const plugins = Array.from({ length: 65 }, (_, index) => `mod-${index}`);
        for (const plugin of plugins) {
          yield* hub.publish({
            providerSessionId,
            threadId,
            event: { type: "status", plugin, text: "busy" },
          });
        }

        assert.deepStrictEqual(
          [...(yield* pull)],
          [
            {
              type: "snapshot",
              state: {
                ...EMPTY_MOD_SURFACE_STATE,
                availability: "available",
                statuses: plugins.map((plugin) => ({ plugin, text: "busy" })),
              },
            },
          ],
        );
      }),
    ),
  );
});
