import { BrowserNotificationOriginInput, BrowserNotificationPermission } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as BrowserNotificationPermissions from "../../preview/BrowserNotificationPermissions.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const listBrowserNotificationPermissions = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_NOTIFICATION_PERMISSIONS_LIST_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(BrowserNotificationPermission),
  handler: Effect.fn("desktop.ipc.browserNotificationPermissions.list")(function* () {
    return yield* (yield* BrowserNotificationPermissions.BrowserNotificationPermissions).list;
  }),
});

export const removeBrowserNotificationPermission = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_NOTIFICATION_PERMISSIONS_REMOVE_CHANNEL,
  payload: BrowserNotificationOriginInput,
  result: Schema.Array(BrowserNotificationPermission),
  handler: Effect.fn("desktop.ipc.browserNotificationPermissions.remove")(function* ({ origin }) {
    return yield* (yield* BrowserNotificationPermissions.BrowserNotificationPermissions).remove(
      origin,
    );
  }),
});
