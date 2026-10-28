import {
  isModSurfaceActionError,
  ModSurfaceActionError,
  type ModSurfaceActInput,
  type ModSurfaceActResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ModSurfaceHub from "./ModSurfaceHub.ts";

/**
 * A mod's handler runs arbitrary plugin code; one that never answers must not
 * leave the client's buttons waiting forever. Interrupting cancels the request.
 */
const ACT_TIMEOUT = "30 seconds";

/**
 * A press, an edit of a field, a pick or a close reaches the process that drew the mod. A stopped session is
 * reported, never started: a stale drawing must not spend a provider turn.
 */
export class ModSurfaceActions extends Context.Service<
  ModSurfaceActions,
  {
    readonly act: (
      input: ModSurfaceActInput,
    ) => Effect.Effect<ModSurfaceActResult, ModSurfaceActionError>;
  }
>()("t3/mods/ModSurfaceActions") {}

const make = Effect.gen(function* () {
  const hub = yield* ModSurfaceHub.ModSurfaceHub;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;

  const act = Effect.fn("ModSurfaceActions.act")(function* (input: ModSurfaceActInput) {
    const fail = (reason: ModSurfaceActionError["reason"], cause?: unknown) =>
      new ModSurfaceActionError({
        threadId: input.threadId,
        reason,
        ...(cause === undefined ? {} : { cause }),
      });
    const providerSessionId = yield* hub.owner(input.threadId);
    if (providerSessionId === undefined) return yield* fail("session-stopped");
    const runtime = Option.getOrUndefined(
      yield* providerSessions
        .get(providerSessionId)
        .pipe(Effect.mapError((cause) => fail("request-failed", cause))),
    );
    if (runtime === undefined) return yield* fail("session-stopped");
    if (runtime.mods === undefined) return yield* fail("provider-unsupported");
    return yield* runtime.mods.act({ threadId: input.threadId, action: input.action }).pipe(
      Effect.mapError((cause) =>
        // An adapter whose process no longer serves the thread says so in a
        // stopped-session error of its own.
        "cause" in cause && isModSurfaceActionError(cause.cause)
          ? cause.cause
          : fail("request-failed", cause),
      ),
      Effect.timeoutOrElse({
        duration: ACT_TIMEOUT,
        orElse: () => Effect.fail(fail("request-failed")),
      }),
    );
  });

  return ModSurfaceActions.of({ act });
});

export const layer = Layer.effect(ModSurfaceActions, make);
