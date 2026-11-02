import { BrowserMediaPermission, BrowserMediaPermissionKeyInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as BrowserMediaPermissions from "../../preview/BrowserMediaPermissions.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const listBrowserMediaPermissions = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_MEDIA_PERMISSIONS_LIST_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(BrowserMediaPermission),
  handler: Effect.fn("desktop.ipc.browserMediaPermissions.list")(function* () {
    return yield* (yield* BrowserMediaPermissions.BrowserMediaPermissions).list;
  }),
});

export const removeBrowserMediaPermission = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_MEDIA_PERMISSIONS_REMOVE_CHANNEL,
  payload: BrowserMediaPermissionKeyInput,
  result: Schema.Array(BrowserMediaPermission),
  handler: Effect.fn("desktop.ipc.browserMediaPermissions.remove")(function* ({ origin, device }) {
    return yield* (yield* BrowserMediaPermissions.BrowserMediaPermissions).remove(origin, device);
  }),
});
