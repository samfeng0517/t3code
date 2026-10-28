import * as Schema from "effect/Schema";

export const BrowserNotificationDecision = Schema.Literals(["allow", "block"]);
export type BrowserNotificationDecision = typeof BrowserNotificationDecision.Type;

/** A site's remembered answer to the browser panel's notification prompt. */
export const BrowserNotificationPermission = Schema.Struct({
  origin: Schema.String,
  decision: BrowserNotificationDecision,
});
export type BrowserNotificationPermission = typeof BrowserNotificationPermission.Type;

export const BrowserNotificationOriginInput = Schema.Struct({ origin: Schema.String });
export type BrowserNotificationOriginInput = typeof BrowserNotificationOriginInput.Type;
