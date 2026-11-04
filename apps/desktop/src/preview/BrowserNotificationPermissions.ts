import {
  BrowserNotificationPermission,
  type BrowserNotificationDecision,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makePermissionStore } from "./BrowserPermissionStore.ts";

export class BrowserNotificationPermissions extends Context.Service<
  BrowserNotificationPermissions,
  {
    /** Synchronous because Electron's permission check handler cannot wait. */
    readonly decisionFor: (origin: string) => BrowserNotificationDecision | undefined;
    readonly set: (origin: string, decision: BrowserNotificationDecision) => Effect.Effect<void>;
    readonly remove: (
      origin: string,
    ) => Effect.Effect<ReadonlyArray<BrowserNotificationPermission>>;
    readonly list: Effect.Effect<ReadonlyArray<BrowserNotificationPermission>>;
  }
>()("@t3tools/desktop/preview/BrowserNotificationPermissions") {}

export const makeAt = Effect.fn("BrowserNotificationPermissions.make")(function* (
  storePath: string,
) {
  const store = yield* makePermissionStore({
    storePath,
    site: BrowserNotificationPermission,
    keyOf: (site) => site.origin,
    compare: (left, right) => left.origin.localeCompare(right.origin),
    label: "browser notification permissions",
  });

  return BrowserNotificationPermissions.of({
    decisionFor: (origin) => store.get(origin)?.decision,
    set: Effect.fn("BrowserNotificationPermissions.set")(function* (origin, decision) {
      yield* store.put({ origin, decision });
    }),
    remove: Effect.fn("BrowserNotificationPermissions.remove")(function* (origin) {
      return yield* store.delete(origin);
    }),
    list: store.list,
  });
});

const BROWSER_NOTIFICATION_PERMISSIONS_FILE_NAME = "browser-notification-permissions.json";

export const layer = Layer.effect(
  BrowserNotificationPermissions,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return yield* makeAt(
      environment.path.join(environment.stateDir, BROWSER_NOTIFICATION_PERMISSIONS_FILE_NAME),
    );
  }),
);
