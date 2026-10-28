import type {
  BrowserBookmarkReadResult,
  BrowserBookmarkSource,
  BrowserBookmarkTreeNode,
  DesktopPreviewReadBookmarksInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import {
  BROWSER_IMPORT_SOURCES,
  listSourceProfiles,
  type BrowserImportPathContext,
  type BrowserImportSourceDefinition,
} from "./Sources.ts";

// Bounds what crosses IPC and lands in the renderer's local storage; a real bookmarks file is
// far below these.
const MAX_BOOKMARK_FILE_BYTES = 32 * 1024 * 1024;
const MAX_BOOKMARK_NODES = 20_000;
const MAX_BOOKMARK_DEPTH = 32;
const MAX_TITLE_LENGTH = 512;
const MAX_URL_LENGTH = 2048;

export class BrowserBookmarkReadError extends Schema.TaggedError<BrowserBookmarkReadError>()(
  "BrowserBookmarkReadError",
  {
    sourceId: Schema.String,
    reason: Schema.Literals(["unknownSource", "unknownSourceProfile", "readFailed"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Reading bookmarks from ${this.sourceId} failed: ${this.reason}.`;
  }
}

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Only pages the in-app browser can open; bookmarklets and `chrome://` pages are dropped. */
const webUrl = (raw: unknown): string | undefined => {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const nodeTitle = (raw: unknown): string =>
  typeof raw === "string" ? raw.trim().slice(0, MAX_TITLE_LENGTH) : "";

/**
 * Chrome's `Bookmarks` file as its top-level folders: bookmarks bar, other, and mobile
 * (`synced`), each keeping its own folder structure. Empty roots are left out.
 */
export function normalizeChromiumBookmarks(raw: unknown): ReadonlyArray<BrowserBookmarkTreeNode> {
  if (!isRecord(raw) || !isRecord(raw.roots)) return [];
  let budget = MAX_BOOKMARK_NODES;
  const children = (value: unknown, depth: number): BrowserBookmarkTreeNode[] => {
    if (!Array.isArray(value) || depth > MAX_BOOKMARK_DEPTH) return [];
    const nodes: BrowserBookmarkTreeNode[] = [];
    for (const candidate of value) {
      if (budget <= 0) break;
      if (!isRecord(candidate)) continue;
      if (candidate.type === "url") {
        const url = webUrl(candidate.url);
        if (url === undefined) continue;
        budget -= 1;
        nodes.push({ title: nodeTitle(candidate.name), url });
      } else if (candidate.type === "folder") {
        budget -= 1;
        nodes.push({
          title: nodeTitle(candidate.name),
          children: children(candidate.children, depth + 1),
        });
      }
    }
    return nodes;
  };
  const roots: BrowserBookmarkTreeNode[] = [];
  for (const key of ["bookmark_bar", "other", "synced"] as const) {
    const root = raw.roots[key];
    if (!isRecord(root)) continue;
    const rootChildren = children(root.children, 1);
    if (rootChildren.length > 0)
      roots.push({ title: nodeTitle(root.name), children: rootChildren });
  }
  return roots;
}

// Plain-file reads (bookmarks, installed extensions) use the bookmark directory where one is
// set, so profile listing and the file path both look there; cookie import keeps the plain
// `userDataDirectory`.
export const chromiumSources = BROWSER_IMPORT_SOURCES.filter(
  (source) => source.engine === "chromium",
).map((source): BrowserImportSourceDefinition => {
  const bookmarksDirectory = source.bookmarksUserDataDirectory;
  return bookmarksDirectory === undefined
    ? source
    : {
        ...source,
        userDataDirectory: (context) =>
          source.userDataDirectory(context) ?? bookmarksDirectory(context),
      };
});

const bookmarksPath = (
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  directory: string,
): string | undefined => {
  const root = definition.userDataDirectory(context);
  return root === undefined ? undefined : context.path.join(root, directory, "Bookmarks");
};

const fileExists = Effect.fnUntraced(function* (path: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.stat(path).pipe(
    Effect.map((info) => info.type === "File"),
    Effect.orElseSucceed(() => false),
  );
});

const bookmarkProfiles = Effect.fnUntraced(function* (
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
) {
  const profiles = yield* listSourceProfiles(definition, context);
  const withBookmarks = yield* Effect.forEach(profiles, (profile) => {
    const path = bookmarksPath(definition, context, profile.directory);
    return (path === undefined ? Effect.succeed(false) : fileExists(path)).pipe(
      Effect.map((exists) =>
        exists ? { directory: profile.directory, name: profile.name } : undefined,
      ),
    );
  });
  return withBookmarks.filter((profile) => profile !== undefined);
});

/**
 * Chromium-based sources the cookie import already detects, limited to profiles holding a
 * bookmarks file. Unlike cookies, the file is plain JSON, so a running browser is no obstacle.
 */
export const listBookmarkSources = Effect.fn("ChromiumBookmarks.listBookmarkSources")(function* (
  context: BrowserImportPathContext,
): Effect.fn.Return<ReadonlyArray<BrowserBookmarkSource>, never, FileSystem.FileSystem> {
  const sources = yield* Effect.forEach(chromiumSources, (definition) =>
    bookmarkProfiles(definition, context).pipe(
      Effect.map((profiles) => ({ id: definition.id, name: definition.name, profiles })),
    ),
  );
  return sources.filter((source) => source.profiles.length > 0);
});

export const readBookmarks = Effect.fn("ChromiumBookmarks.readBookmarks")(function* (
  context: BrowserImportPathContext,
  input: DesktopPreviewReadBookmarksInput,
): Effect.fn.Return<BrowserBookmarkReadResult, BrowserBookmarkReadError, FileSystem.FileSystem> {
  const definition = chromiumSources.find((source) => source.id === input.sourceId);
  if (definition === undefined) {
    return yield* new BrowserBookmarkReadError({
      sourceId: input.sourceId,
      reason: "unknownSource",
    });
  }
  // The directory arrives over IPC, so it is only honoured when the source itself listed it;
  // `..` segments would otherwise read any file named `Bookmarks` on disk.
  const profiles = yield* bookmarkProfiles(definition, context);
  const path = profiles.some((profile) => profile.directory === input.sourceProfileDirectory)
    ? bookmarksPath(definition, context, input.sourceProfileDirectory)
    : undefined;
  if (path === undefined) {
    return yield* new BrowserBookmarkReadError({
      sourceId: definition.id,
      reason: "unknownSourceProfile",
    });
  }
  const fileSystem = yield* FileSystem.FileSystem;
  const readFailed = (cause?: unknown) =>
    new BrowserBookmarkReadError({ sourceId: definition.id, reason: "readFailed", cause });
  const info = yield* fileSystem.stat(path).pipe(Effect.mapError(readFailed));
  if (Number(info.size) > MAX_BOOKMARK_FILE_BYTES) return yield* readFailed();
  const text = yield* fileSystem.readFileString(path).pipe(Effect.mapError(readFailed));
  const parsed = yield* decodeJson(text).pipe(Effect.mapError(readFailed));
  return { roots: normalizeChromiumBookmarks(parsed) };
});
