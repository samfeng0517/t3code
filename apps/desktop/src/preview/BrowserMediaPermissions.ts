import {
  BrowserMediaPermission,
  type BrowserMediaDecision,
  type BrowserMediaDevice,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makePermissionStore } from "./BrowserPermissionStore.ts";

export class BrowserMediaPermissions extends Context.Service<
  BrowserMediaPermissions,
  {
    /** Synchronous because Electron's permission check handler cannot wait. */
    readonly decisionFor: (
      origin: string,
      device: BrowserMediaDevice,
    ) => BrowserMediaDecision | undefined;
    readonly set: (
      origin: string,
      device: BrowserMediaDevice,
      decision: BrowserMediaDecision,
    ) => Effect.Effect<void>;
    readonly remove: (
      origin: string,
      device: BrowserMediaDevice,
    ) => Effect.Effect<ReadonlyArray<BrowserMediaPermission>>;
    readonly list: Effect.Effect<ReadonlyArray<BrowserMediaPermission>>;
  }
>()("@t3tools/desktop/preview/BrowserMediaPermissions") {}

const keyOf = (origin: string, device: BrowserMediaDevice) => JSON.stringify([origin, device]);
const DEVICE_ORDER: Record<BrowserMediaDevice, number> = { microphone: 0, camera: 1 };

export const makeAt = Effect.fn("BrowserMediaPermissions.make")(function* (storePath: string) {
  const store = yield* makePermissionStore({
    storePath,
    site: BrowserMediaPermission,
    keyOf: (site) => keyOf(site.origin, site.device),
    compare: (left, right) =>
      left.origin.localeCompare(right.origin) ||
      DEVICE_ORDER[left.device] - DEVICE_ORDER[right.device],
    label: "browser media permissions",
  });

  return BrowserMediaPermissions.of({
    decisionFor: (origin, device) => store.get(keyOf(origin, device))?.decision,
    set: Effect.fn("BrowserMediaPermissions.set")(function* (origin, device, decision) {
      yield* store.put({ origin, device, decision });
    }),
    remove: Effect.fn("BrowserMediaPermissions.remove")(function* (origin, device) {
      return yield* store.delete(keyOf(origin, device));
    }),
    list: store.list,
  });
});

const BROWSER_MEDIA_PERMISSIONS_FILE_NAME = "browser-media-permissions.json";

/** @public */
export const layer = Layer.effect(
  BrowserMediaPermissions,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return yield* makeAt(
      environment.path.join(environment.stateDir, BROWSER_MEDIA_PERMISSIONS_FILE_NAME),
    );
  }),
);
