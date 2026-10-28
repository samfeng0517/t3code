import {
  BrowserExtensionAddFromSourceInput,
  BrowserExtensionMutationResult,
  BrowserExtensionPathInput,
  BrowserExtensionSetEnabledInput,
  BrowserExtensionSourceBrowser,
  BrowserExtensionStatus,
  BrowserExtensionUpdateResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as BrowserExtensions from "../../preview/BrowserExtensions.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const listBrowserExtensions = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_EXTENSIONS_LIST_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(BrowserExtensionStatus),
  handler: Effect.fn("desktop.ipc.browserExtensions.list")(function* () {
    return yield* (yield* BrowserExtensions.BrowserExtensions).list;
  }),
});

export const addBrowserExtension = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_EXTENSIONS_ADD_CHANNEL,
  payload: BrowserExtensionPathInput,
  result: BrowserExtensionMutationResult,
  handler: Effect.fn("desktop.ipc.browserExtensions.add")(function* ({ path }) {
    return yield* (yield* BrowserExtensions.BrowserExtensions).add(path);
  }),
});

export const setBrowserExtensionEnabled = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_EXTENSIONS_SET_ENABLED_CHANNEL,
  payload: BrowserExtensionSetEnabledInput,
  result: BrowserExtensionMutationResult,
  handler: Effect.fn("desktop.ipc.browserExtensions.setEnabled")(function* ({ path, enabled }) {
    return yield* (yield* BrowserExtensions.BrowserExtensions).setEnabled(path, enabled);
  }),
});

export const removeBrowserExtension = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_EXTENSIONS_REMOVE_CHANNEL,
  payload: BrowserExtensionPathInput,
  result: BrowserExtensionMutationResult,
  handler: Effect.fn("desktop.ipc.browserExtensions.remove")(function* ({ path }) {
    return yield* (yield* BrowserExtensions.BrowserExtensions).remove(path);
  }),
});

export const listBrowserExtensionSources = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_EXTENSIONS_LIST_SOURCES_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(BrowserExtensionSourceBrowser),
  handler: Effect.fn("desktop.ipc.browserExtensions.listSources")(function* () {
    return yield* (yield* BrowserExtensions.BrowserExtensions).listSources;
  }),
});

export const addBrowserExtensionFromSource = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_EXTENSIONS_ADD_FROM_SOURCE_CHANNEL,
  payload: BrowserExtensionAddFromSourceInput,
  result: BrowserExtensionMutationResult,
  handler: Effect.fn("desktop.ipc.browserExtensions.addFromSource")(function* (input) {
    return yield* (yield* BrowserExtensions.BrowserExtensions).addFromSource(input);
  }),
});

export const updateBrowserExtensionsFromSources = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BROWSER_EXTENSIONS_UPDATE_FROM_SOURCES_CHANNEL,
  payload: Schema.Void,
  result: BrowserExtensionUpdateResult,
  handler: Effect.fn("desktop.ipc.browserExtensions.updateFromSources")(function* () {
    return yield* (yield* BrowserExtensions.BrowserExtensions).updateFromSources;
  }),
});
