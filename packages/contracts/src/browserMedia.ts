import * as Schema from "effect/Schema";

export const BrowserMediaDevice = Schema.Literals(["camera", "microphone"]);
export type BrowserMediaDevice = typeof BrowserMediaDevice.Type;

export const BrowserMediaDecision = Schema.Literals(["allow", "block"]);
export type BrowserMediaDecision = typeof BrowserMediaDecision.Type;

/** A site's remembered answer to the browser panel's camera or microphone prompt. */
export const BrowserMediaPermission = Schema.Struct({
  origin: Schema.String,
  device: BrowserMediaDevice,
  decision: BrowserMediaDecision,
});
export type BrowserMediaPermission = typeof BrowserMediaPermission.Type;

export const BrowserMediaPermissionKeyInput = Schema.Struct({
  origin: Schema.String,
  device: BrowserMediaDevice,
});
export type BrowserMediaPermissionKeyInput = typeof BrowserMediaPermissionKeyInput.Type;
