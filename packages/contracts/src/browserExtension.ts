import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { BrowserImportSourceId } from "./browserImport.ts";

export const BROWSER_EXTENSION_MAX_COUNT = 32;

/** An unpacked Chrome extension directory the desktop browser loads into its sessions. */
export const BrowserExtensionPathInput = Schema.Struct({
  path: TrimmedNonEmptyString,
});
export type BrowserExtensionPathInput = typeof BrowserExtensionPathInput.Type;

export const BrowserExtensionSetEnabledInput = Schema.Struct({
  path: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
});
export type BrowserExtensionSetEnabledInput = typeof BrowserExtensionSetEnabledInput.Type;

export const BrowserExtensionProblem = Schema.Literals([
  "missingManifest",
  "invalidManifest",
  "loadFailed",
  /** Copied from a browser that no longer has it; the copy keeps working. */
  "sourceMissing",
  /** The browser has a newer version that could not be copied; the old copy keeps working. */
  "updateFailed",
]);
export type BrowserExtensionProblem = typeof BrowserExtensionProblem.Type;

/** Chromium's extension ids are 32 letters from a to p. */
export const BrowserExtensionId = Schema.String.check(Schema.isPattern(/^[a-p]{32}$/));
export type BrowserExtensionId = typeof BrowserExtensionId.Type;

/** The browser profile an extension was copied from, and kept in sync with. */
export const BrowserExtensionSource = Schema.Struct({
  sourceId: BrowserImportSourceId,
  sourceName: TrimmedNonEmptyString,
  profileDirectory: TrimmedNonEmptyString,
  profileName: TrimmedNonEmptyString,
  extensionId: BrowserExtensionId,
});
export type BrowserExtensionSource = typeof BrowserExtensionSource.Type;

export const BrowserExtensionStatus = Schema.Struct({
  path: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  /** `null` while the manifest is unreadable. */
  name: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
  manifestVersion: Schema.NullOr(Schema.Int),
  problem: Schema.NullOr(BrowserExtensionProblem),
  /** Electron's own message for `loadFailed`; untranslated. */
  detail: Schema.NullOr(Schema.String),
  /** Absent for a folder added by hand. */
  source: Schema.optionalKey(BrowserExtensionSource),
});
export type BrowserExtensionStatus = typeof BrowserExtensionStatus.Type;

export const BrowserExtensionRefusal = Schema.Literals([
  "missingManifest",
  "invalidManifest",
  "alreadyAdded",
  "limitReached",
  /** Some extensions picked from another browser could not be copied. */
  "copyFailed",
]);
export type BrowserExtensionRefusal = typeof BrowserExtensionRefusal.Type;

export const BrowserExtensionMutationResult = Schema.Struct({
  extensions: Schema.Array(BrowserExtensionStatus),
  refusal: Schema.NullOr(BrowserExtensionRefusal),
});
export type BrowserExtensionMutationResult = typeof BrowserExtensionMutationResult.Type;

/** An extension installed in another browser's profile, offered for copying. */
export const BrowserExtensionCandidate = Schema.Struct({
  extensionId: BrowserExtensionId,
  name: Schema.String,
  version: Schema.String,
});
export type BrowserExtensionCandidate = typeof BrowserExtensionCandidate.Type;

export const BrowserExtensionSourceBrowser = Schema.Struct({
  id: BrowserImportSourceId,
  name: TrimmedNonEmptyString,
  profiles: Schema.Array(
    Schema.Struct({
      directory: TrimmedNonEmptyString,
      name: TrimmedNonEmptyString,
      extensions: Schema.Array(BrowserExtensionCandidate),
    }),
  ),
});
export type BrowserExtensionSourceBrowser = typeof BrowserExtensionSourceBrowser.Type;

export const BrowserExtensionAddFromSourceInput = Schema.Struct({
  sourceId: BrowserImportSourceId,
  profileDirectory: TrimmedNonEmptyString,
  extensionIds: Schema.Array(BrowserExtensionId),
});
export type BrowserExtensionAddFromSourceInput = typeof BrowserExtensionAddFromSourceInput.Type;

export const BrowserExtensionUpdateResult = Schema.Struct({
  extensions: Schema.Array(BrowserExtensionStatus),
  /** The copies refreshed from their browser in this run, with their new version. */
  updated: Schema.Array(Schema.Struct({ name: Schema.String, version: Schema.String })),
});
export type BrowserExtensionUpdateResult = typeof BrowserExtensionUpdateResult.Type;
