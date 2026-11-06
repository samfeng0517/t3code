import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";

import * as ServerConfig from "./config.ts";
import * as ServerSettings from "./serverSettings.ts";

/** Null for filesystem roots or settings not absolute on this host, including synced foreign-platform paths. */
export function resolveWorktreesDirectory(
  setting: string,
  defaultDir: string,
  path: Path.Path,
  home: string,
): string | null {
  if (setting === "") return defaultDir;
  const expanded = expandHomePath(setting, home);
  if (!path.isAbsolute(expanded)) return null;
  const resolved = path.resolve(expanded);
  return isFilesystemRoot(resolved, path) ? null : resolved;
}

/** Callers re-check after resolving symlinks: a link can point at a root. */
export function isFilesystemRoot(directory: string, path: Path.Path): boolean {
  return path.dirname(directory) === directory;
}

export function managedWorktreesDirectories(
  settings: {
    readonly worktreesDirectory: string;
    readonly previousWorktreesDirectories: ReadonlyArray<string>;
  },
  defaultDir: string,
  path: Path.Path,
  home: string,
): ReadonlyArray<string> {
  const directories = new Set([defaultDir]);
  for (const setting of [settings.worktreesDirectory, ...settings.previousWorktreesDirectories]) {
    const directory = resolveWorktreesDirectory(setting, defaultDir, path, home);
    if (directory !== null) directories.add(directory);
  }
  return [...directories];
}

// Match Git's symlink-following location: nearest real ancestor plus missing path components.
function makeRealLocation(fileSystem: FileSystem.FileSystem, path: Path.Path) {
  const realLocation = (target: string): Effect.Effect<string> =>
    fileSystem.realPath(target).pipe(
      Effect.catch(() => {
        const parent = path.dirname(target);
        return parent === target
          ? Effect.succeed(target)
          : Effect.map(realLocation(parent), (real) => path.join(real, path.basename(target)));
      }),
    );
  return realLocation;
}

/**
 * Finds the recorded worktree paths that name the same checkout as a given one. Git reports real
 * paths, while threads keep the spelling they were given: a symlinked parent, a trailing
 * separator, or Windows slashes and case.
 */
export const makeWorktreeThreadMatcher = Effect.gen(function* () {
  const path = yield* Path.Path;
  const realLocation = makeRealLocation(yield* FileSystem.FileSystem, path);
  const isWindows = yield* HostProcess.isWindows;
  // Untraced: it runs once per recorded path inside the matcher's span.
  const keyOf = Effect.fnUntraced(function* (worktreePath: string) {
    const real = yield* realLocation(path.resolve(worktreePath));
    return isWindows ? real.toLowerCase() : real;
  });
  return Effect.fn("worktreesDirectory.matchWorktreeThreads")(function* <Id>(
    worktreePath: string,
    recorded: ReadonlyArray<{ readonly threadId: Id; readonly worktreePath: string }>,
  ) {
    const target = yield* keyOf(worktreePath);
    const keys = new Map<string, string>();
    const threadIds: Id[] = [];
    for (const entry of recorded) {
      let key = keys.get(entry.worktreePath);
      if (key === undefined) {
        key = yield* keyOf(entry.worktreePath);
        keys.set(entry.worktreePath, key);
      }
      if (key === target) threadIds.push(entry.threadId);
    }
    return threadIds;
  });
});

// Client paths/branches are untrusted; recreate only real paths matching managed-folder/repo/branch.
export const makeIsManagedWorktreePath = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const realLocation = makeRealLocation(fileSystem, path);

  return Effect.fn("worktreesDirectory.isManagedWorktreePath")(function* (worktreePath: string) {
    // git resolves a relative path against the project, not the server cwd.
    if (!path.isAbsolute(worktreePath)) return false;
    // Require normalized paths; Git and realPath disagree on .. after symlink traversal.
    if (path.resolve(worktreePath) !== worktreePath) return false;
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.orElseSucceed(() => ({
        worktreesDirectory: "",
        previousWorktreesDirectories: [],
      })),
    );
    const roots = yield* Effect.forEach(
      managedWorktreesDirectories(
        settings,
        serverConfig.worktreesDir,
        path,
        yield* HostProcess.HomeDirectory,
      ),
      realLocation,
    );
    const candidate = yield* realLocation(worktreePath);
    return roots.some((root) => {
      if (isFilesystemRoot(root, path)) return false;
      const relative = path.relative(root, candidate);
      const segments = relative.split(path.sep);
      return (
        !path.isAbsolute(relative) &&
        segments.length === 2 &&
        segments.every((segment) => segment !== "" && segment !== "..")
      );
    });
  });
});
