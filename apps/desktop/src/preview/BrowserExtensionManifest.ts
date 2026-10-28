import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

export interface ParsedExtensionManifest {
  readonly name: string | null;
  readonly version: string | null;
  readonly manifestVersion: number | null;
  readonly defaultLocale: string | null;
}

const stringField = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

/** `null` when the text is not a manifest Chromium would accept as one. */
export function parseExtensionManifest(raw: string): ParsedExtensionManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^﻿/, ""));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const manifest = value as Record<string, unknown>;
  const manifestVersion = manifest.manifest_version;
  if (
    stringField(manifest.name) === null ||
    stringField(manifest.version) === null ||
    (manifestVersion !== 2 && manifestVersion !== 3)
  ) {
    return null;
  }
  return {
    name: stringField(manifest.name),
    version: stringField(manifest.version),
    manifestVersion,
    defaultLocale: stringField(manifest.default_locale),
  };
}

const LOCALIZED_MESSAGE_PATTERN = /^__MSG_(.+)__$/;

export function localizedMessageKey(name: string): string | null {
  return LOCALIZED_MESSAGE_PATTERN.exec(name)?.[1] ?? null;
}

/** Chromium matches message keys case-insensitively. */
export function resolveLocalizedMessage(key: string, messagesRaw: string): string | null {
  let messages: unknown;
  try {
    messages = JSON.parse(messagesRaw.replace(/^﻿/, ""));
  } catch {
    return null;
  }
  if (typeof messages !== "object" || messages === null) return null;
  const wanted = key.toLowerCase();
  for (const [candidate, entry] of Object.entries(messages)) {
    if (candidate.toLowerCase() !== wanted) continue;
    const message = (entry as { readonly message?: unknown } | null)?.message;
    return stringField(message);
  }
  return null;
}

export type ExtensionManifestRead = ParsedExtensionManifest | "missingManifest" | "invalidManifest";

export const readExtensionManifest = Effect.fnUntraced(function* (extensionPath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fileSystem.readFileString(path.join(extensionPath, "manifest.json")).pipe(
    Effect.map((raw): ExtensionManifestRead => parseExtensionManifest(raw) ?? "invalidManifest"),
    Effect.orElseSucceed((): ExtensionManifestRead => "missingManifest"),
  );
});

/** The manifest's name, with a `__MSG_key__` name resolved from the default locale. */
export const extensionDisplayName = Effect.fnUntraced(function* (
  extensionPath: string,
  manifest: ParsedExtensionManifest,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const key = manifest.name === null ? null : localizedMessageKey(manifest.name);
  if (key === null || manifest.defaultLocale === null) return manifest.name;
  const messages = yield* fileSystem
    .readFileString(path.join(extensionPath, "_locales", manifest.defaultLocale, "messages.json"))
    .pipe(Effect.option);
  return Option.match(messages, {
    onNone: () => manifest.name,
    onSome: (raw) => resolveLocalizedMessage(key, raw) ?? manifest.name,
  });
});

/** Orders Chromium's dotted versions ("1.10" after "1.9"); a missing part counts as 0. */
export function compareExtensionVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
