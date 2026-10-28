import {
  applyModSurfaceEvent,
  EMPTY_MOD_SURFACE_STATE,
  type ModSurfaceEvent,
  type ModSurfaceFrame,
  type ModSurfaceState,
  type ProviderSessionId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

/**
 * Live mod drawings, per thread. A drawing names press handlers that live in the provider
 * process, so it dies with that process and never becomes an orchestration event. Adapters
 * push changes here, and `subscribe` serves a snapshot then changes.
 */

/** Threads whose drawings are kept at once; the least recently changed is dropped beyond this. */
const MAX_THREADS = 256;
/** Frames a subscriber may fall behind by before it is sent a snapshot instead. */
const MAX_PENDING_FRAMES = 64;

interface Subscriber {
  pending: Array<ModSurfaceFrame>;
  readonly wake: Queue.Queue<void>;
}

interface ThreadSurface {
  readonly providerSessionId: ProviderSessionId;
  readonly state: ModSurfaceState;
}

export interface ModSurfaceHubShape {
  readonly publish: (input: {
    readonly providerSessionId: ProviderSessionId;
    readonly threadId: ThreadId;
    readonly event: ModSurfaceEvent;
  }) => Effect.Effect<void>;
  /** The session's process ended: everything it drew is gone. */
  readonly releaseSession: (providerSessionId: ProviderSessionId) => Effect.Effect<void>;
  /** The provider session whose process drew the thread's current mods. */
  readonly owner: (threadId: ThreadId) => Effect.Effect<ProviderSessionId | undefined>;
  readonly subscribe: (threadId: ThreadId) => Stream.Stream<ModSurfaceFrame>;
}

export class ModSurfaceHub extends Context.Service<ModSurfaceHub, ModSurfaceHubShape>()(
  "t3/mods/ModSurfaceHub",
) {}

export const make = Effect.sync(() => {
  // Insertion order doubles as recency: every write re-inserts its entry.
  const surfaces = new Map<ThreadId, ThreadSurface>();
  const subscribers = new Map<ThreadId, Set<Subscriber>>();

  const stateOf = (threadId: ThreadId) => surfaces.get(threadId)?.state ?? EMPTY_MOD_SURFACE_STATE;

  const send = (threadId: ThreadId, frame: ModSurfaceFrame) =>
    Effect.forEach(
      subscribers.get(threadId) ?? [],
      (subscriber) => {
        subscriber.pending =
          subscriber.pending.length >= MAX_PENDING_FRAMES
            ? [{ type: "snapshot", state: stateOf(threadId) }]
            : [...subscriber.pending, frame];
        return Queue.offer(subscriber.wake, undefined);
      },
      { discard: true },
    );

  const publish: ModSurfaceHubShape["publish"] = ({ providerSessionId, threadId, event }) =>
    Effect.suspend(() => {
      // Only a new process attaching takes a thread over. Anything else from a
      // session that no longer owns the thread comes from a process that has
      // been replaced, and would wipe or overwrite what its successor drew.
      const current = surfaces.get(threadId);
      if (
        current !== undefined &&
        current.providerSessionId !== providerSessionId &&
        !(event.type === "reset" && event.availability !== "inactive")
      ) {
        return Effect.void;
      }
      const state = applyModSurfaceEvent(stateOf(threadId), event);
      surfaces.delete(threadId);
      surfaces.set(threadId, { providerSessionId, state });
      const evicted: Array<ThreadId> = [];
      while (surfaces.size > MAX_THREADS) {
        const oldest = surfaces.keys().next().value!;
        surfaces.delete(oldest);
        evicted.push(oldest);
      }
      return send(threadId, event).pipe(
        Effect.andThen(
          Effect.forEach(
            evicted,
            (oldest) => send(oldest, { type: "reset", availability: "inactive" }),
            { discard: true },
          ),
        ),
      );
    });

  const releaseSession: ModSurfaceHubShape["releaseSession"] = (providerSessionId) =>
    Effect.suspend(() => {
      const released = [...surfaces]
        .filter(([, surface]) => surface.providerSessionId === providerSessionId)
        .map(([threadId]) => threadId);
      for (const threadId of released) surfaces.delete(threadId);
      return Effect.forEach(
        released,
        (threadId) => send(threadId, { type: "reset", availability: "inactive" }),
        { discard: true },
      );
    });

  const owner: ModSurfaceHubShape["owner"] = (threadId) =>
    Effect.sync(() => surfaces.get(threadId)?.providerSessionId);

  const subscribe: ModSurfaceHubShape["subscribe"] = (threadId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscriber: Subscriber = {
          // Read and attach in one step, so no change falls between them.
          pending: [{ type: "snapshot", state: stateOf(threadId) }],
          wake: yield* Queue.sliding<void>(1),
        };
        const threadSubscribers = subscribers.get(threadId) ?? new Set<Subscriber>();
        threadSubscribers.add(subscriber);
        subscribers.set(threadId, threadSubscribers);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            threadSubscribers.delete(subscriber);
            if (threadSubscribers.size === 0 && subscribers.get(threadId) === threadSubscribers) {
              subscribers.delete(threadId);
            }
          }),
        );
        yield* Queue.offer(subscriber.wake, undefined);
        const drain = Queue.take(subscriber.wake).pipe(
          Effect.map(() => {
            const frames = subscriber.pending;
            subscriber.pending = [];
            return frames;
          }),
        );
        return Stream.fromEffectRepeat(drain).pipe(Stream.flatMap(Stream.fromIterable));
      }),
    );

  return ModSurfaceHub.of({ publish, releaseSession, owner, subscribe });
});

export const layer = Layer.effect(ModSurfaceHub, make);
