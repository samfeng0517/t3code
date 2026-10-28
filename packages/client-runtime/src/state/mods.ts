import {
  applyModSurfaceEvent,
  EMPTY_MOD_SURFACE_STATE,
  WS_METHODS,
  type EnvironmentId,
  type ModSurfaceFrame,
  type ModSurfaceState,
  type ModToast,
  type ThreadId,
} from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Toasts a client keeps so a view that mounts late can still raise the newest. */
const MAX_RECENT_TOASTS = 20;

/** One thread's mod surface as a client holds it. */
export interface ModSurfaceView extends ModSurfaceState {
  /** Newest last. Toasts are live only: a fresh subscription starts with none. */
  readonly toasts: ReadonlyArray<ModToast>;
}

export const EMPTY_MOD_SURFACE_VIEW: ModSurfaceView = { ...EMPTY_MOD_SURFACE_STATE, toasts: [] };

export function applyModSurfaceFrame(view: ModSurfaceView, frame: ModSurfaceFrame): ModSurfaceView {
  switch (frame.type) {
    case "snapshot":
      return { ...frame.state, toasts: view.toasts };
    case "toast":
      return { ...view, toasts: [...view.toasts, frame.toast].slice(-MAX_RECENT_TOASTS) };
    case "reset":
      return { ...applyModSurfaceEvent(view, frame), toasts: [] };
    default: {
      const state = applyModSurfaceEvent(view, frame);
      return state === view ? view : { ...state, toasts: view.toasts };
    }
  }
}

const lastRaisedModToastFamily = Atom.family((_key: string) =>
  Atom.make<string | null>(null).pipe(Atom.keepAlive),
);

/**
 * The id of the newest toast a client raised for a thread. It outlives the view
 * that raised it, so a view that mounts again does not raise the kept toasts a
 * second time.
 */
export const lastRaisedModToast = (environmentId: EnvironmentId, threadId: ThreadId) =>
  lastRaisedModToastFamily(`${environmentId}\u001f${threadId}`);

export function createModEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // One thread's mod surface; mounted only while that thread is on screen.
    surface: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:mods:surface",
      tag: WS_METHODS.modsSubscribeThread,
      idleTtlMs: 0,
      transform: (frames) =>
        frames.pipe(
          Stream.scan(() => EMPTY_MOD_SURFACE_VIEW, applyModSurfaceFrame),
          // `scan` emits its seed first; the snapshot that follows is the real state.
          Stream.drop(1),
        ),
    }),
    act: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mods:act",
      tag: WS_METHODS.modsAct,
    }),
  };
}
