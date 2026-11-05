import { ipcRenderer } from "electron";

import {
  MEDIA_PERMISSION_STATE_CHANNEL,
  PASSKEY_BRIDGE_ARGUMENT,
} from "./preview/GuestProtocol.ts";
import { installMediaPermissionQuery } from "./preview/MediaPermissionQuery.ts";
import { installPasskeyBridge } from "./preview/PasskeyBridge.ts";
import "./preview/PickPreload.ts";

// Electron hands webPreferences.additionalArguments to sandboxed preloads in process.argv.
if (process.argv.includes(PASSKEY_BRIDGE_ARGUMENT)) {
  installPasskeyBridge((channel, publicKey) => ipcRenderer.invoke(channel, publicKey));
}

installMediaPermissionQuery((device) => ipcRenderer.invoke(MEDIA_PERMISSION_STATE_CHANNEL, device));
