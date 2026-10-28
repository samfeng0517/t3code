import type { BrowserExtensionCandidate, BrowserImportSourceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  compareExtensionVersions,
  extensionDisplayName,
  readExtensionManifest,
} from "./BrowserExtensionManifest.ts";
import { chromiumSources } from "./BrowserImport/ChromiumBookmarks.ts";
import {
  isSafeProfileDirectory,
  listChromiumProfileNames,
  type BrowserImportPathContext,
} from "./BrowserImport/Sources.ts";

/** A browser profile whose installed extensions can be copied. */
export interface ExtensionSourceProfile {
  readonly sourceId: BrowserImportSourceId;
  readonly sourceName: string;
  readonly directory: string;
  readonly name: string;
  /** Chromium keeps each extension at `<id>/<version>_<n>/` in here. */
  readonly extensionsDirectory: string;
}

export interface InstalledExtension extends BrowserExtensionCandidate {
  /** The folder holding the newest installed version. */
  readonly path: string;
}

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

/** Every Chromium-based browser profile on this machine, read from plain files only. */
export const listExtensionSourceProfiles = Effect.fnUntraced(function* (
  context: BrowserImportPathContext,
): Effect.fn.Return<ReadonlyArray<ExtensionSourceProfile>, never, FileSystem.FileSystem> {
  const profiles = yield* Effect.forEach(chromiumSources, (definition) => {
    const root = definition.userDataDirectory(context);
    if (root === undefined) return Effect.succeed([]);
    return listChromiumProfileNames(context, root).pipe(
      Effect.map((named) =>
        named
          .filter((profile) => isSafeProfileDirectory(profile.directory))
          .map((profile): ExtensionSourceProfile => ({
            sourceId: definition.id,
            sourceName: definition.name,
            directory: profile.directory,
            name: profile.name,
            extensionsDirectory: context.path.join(root, profile.directory, "Extensions"),
          })),
      ),
    );
  });
  return profiles.flat();
});

/** The newest installed version of one extension, or `null` when none has a valid manifest. */
export const readInstalledExtension = Effect.fnUntraced(function* (
  extensionsDirectory: string,
  extensionId: string,
): Effect.fn.Return<InstalledExtension | null, never, FileSystem.FileSystem | Path.Path> {
  if (!EXTENSION_ID_PATTERN.test(extensionId)) return null;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.join(extensionsDirectory, extensionId);
  const versionDirectories = yield* fileSystem
    .readDirectory(root)
    .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
  let newest: InstalledExtension | null = null;
  for (const directory of versionDirectories) {
    const versionPath = path.join(root, directory);
    const manifest = yield* readExtensionManifest(versionPath);
    if (typeof manifest === "string" || manifest.version === null) continue;
    if (newest !== null && compareExtensionVersions(manifest.version, newest.version) <= 0) {
      continue;
    }
    const name = yield* extensionDisplayName(versionPath, manifest);
    newest = {
      extensionId,
      name: name ?? extensionId,
      version: manifest.version,
      path: versionPath,
    };
  }
  return newest;
});

/** A profile's installed extensions, by name. */
export const listInstalledExtensions = Effect.fnUntraced(function* (extensionsDirectory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const ids = yield* fileSystem
    .readDirectory(extensionsDirectory)
    .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
  const installed = yield* Effect.forEach(
    ids.filter((id) => EXTENSION_ID_PATTERN.test(id)),
    (id) => readInstalledExtension(extensionsDirectory, id),
  );
  return installed
    .filter((extension) => extension !== null)
    .toSorted((left, right) => left.name.localeCompare(right.name));
});
