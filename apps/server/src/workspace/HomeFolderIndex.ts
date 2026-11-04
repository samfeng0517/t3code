// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";

import type {
  FilesystemHomeFolderEntry,
  FilesystemSearchHomeFoldersInput,
  FilesystemSearchHomeFoldersResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
  type RankedSearchResult,
} from "@t3tools/shared/searchRanking";

export class HomeFolderIndex extends Context.Service<
  HomeFolderIndex,
  {
    readonly search: (
      input: FilesystemSearchHomeFoldersInput,
    ) => Effect.Effect<FilesystemSearchHomeFoldersResult>;
  }
>()("t3/workspace/HomeFolderIndex") {}

const MAX_RECORDED_DEPTH = 4;
const MAX_RECORDED_FOLDERS = 20_000;
const READDIR_CONCURRENCY = 16;
const SNAPSHOT_MAX_AGE_MILLIS = 5 * 60 * 1000;

const SKIPPED_FOLDER_NAMES = new Set([
  "Library",
  "node_modules",
  "Applications",
  "Pictures",
  "Music",
  "Movies",
  "AppData",
]);

interface HomeFolder extends FilesystemHomeFolderEntry {
  readonly depth: number;
}

interface Snapshot {
  readonly folders: ReadonlyArray<HomeFolder>;
  readonly scannedAtMillis: number;
}

const readDirents = (directory: string) =>
  Effect.tryPromise(() => NodeFSP.readdir(directory, { withFileTypes: true }));

const scan = Effect.fn("HomeFolderIndex.scan")(function* (home: string, path: Path.Path) {
  const folders: Array<HomeFolder> = [];
  let level: ReadonlyArray<HomeFolder | undefined> = [undefined];
  const homeDirents = yield* readDirents(home);

  for (
    let depth = 0;
    depth < MAX_RECORDED_DEPTH && level.length > 0 && folders.length < MAX_RECORDED_FOLDERS;
    depth += 1
  ) {
    const childrenPerFolder = yield* Effect.forEach(
      level,
      (parent) =>
        Effect.gen(function* () {
          const dirents =
            parent === undefined
              ? homeDirents
              : yield* readDirents(parent.fullPath).pipe(Effect.orElseSucceed(() => []));
          // Folders inside a repository are its sources; the repository is the useful hit.
          if (parent !== undefined && dirents.some((dirent) => dirent.name === ".git")) {
            return [];
          }
          return dirents
            .filter(
              (dirent) =>
                dirent.isDirectory() &&
                !dirent.name.startsWith(".") &&
                !SKIPPED_FOLDER_NAMES.has(dirent.name),
            )
            .map((dirent): HomeFolder => ({
              name: dirent.name,
              fullPath: path.join(parent?.fullPath ?? home, dirent.name),
              homeRelativePath:
                parent === undefined ? dirent.name : `${parent.homeRelativePath}/${dirent.name}`,
              depth: depth + 1,
            }));
        }),
      { concurrency: READDIR_CONCURRENCY },
    );

    const nextLevel: Array<HomeFolder> = [];
    for (const child of childrenPerFolder.flat()) {
      if (folders.length >= MAX_RECORDED_FOLDERS) {
        return folders;
      }
      folders.push(child);
      nextLevel.push(child);
    }
    level = nextLevel;
  }
  return folders;
});

function rankFolders(
  folders: ReadonlyArray<HomeFolder>,
  input: FilesystemSearchHomeFoldersInput,
): FilesystemSearchHomeFoldersResult {
  const query = normalizeSearchQuery(input.query);
  const ranked: Array<RankedSearchResult<HomeFolder>> = [];
  for (const folder of folders) {
    const score = scoreQueryMatch({
      value: folder.name.toLowerCase(),
      query,
      exactBase: 0,
      prefixBase: 1,
      boundaryBase: 2,
      ...(query.length >= 3 ? { includesBase: 3 } : {}),
      boundaryMarkers: [" ", "-", "_", "."],
      ignorePosition: true,
    });
    if (score === null) continue;
    insertRankedSearchResult(
      ranked,
      { item: folder, score, tieBreaker: `${folder.depth}\u0000${folder.name}` },
      input.limit,
    );
  }
  return {
    entries: ranked.map(({ item }) => ({
      name: item.name,
      fullPath: item.fullPath,
      homeRelativePath: item.homeRelativePath,
    })),
  };
}

export const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const scope = yield* Effect.scope;
  const startScanSemaphore = yield* Semaphore.make(1);

  let snapshot: Snapshot | undefined;

  const scanAndStore = scan(home, path).pipe(
    Effect.tap((folders) =>
      Effect.map(Clock.currentTimeMillis, (scannedAtMillis) => {
        snapshot = { folders, scannedAtMillis };
      }),
    ),
    Effect.tapError((cause) => Effect.logWarning("Failed to scan home folders", { home, cause })),
    Effect.ensuring(
      Effect.sync(() => {
        inFlightScan = undefined;
      }),
    ),
  );

  let inFlightScan:
    | Fiber.Fiber<Effect.Success<typeof scanAndStore>, Effect.Error<typeof scanAndStore>>
    | undefined;

  const freshFoldersOrScan = startScanSemaphore.withPermits(1)(
    Effect.uninterruptible(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (snapshot !== undefined && now - snapshot.scannedAtMillis < SNAPSHOT_MAX_AGE_MILLIS) {
          return snapshot.folders;
        }
        inFlightScan ??= yield* Effect.forkIn(scanAndStore, scope);
        return inFlightScan;
      }),
    ),
  );

  const search: HomeFolderIndex["Service"]["search"] = Effect.fn("HomeFolderIndex.search")(
    function* (input) {
      const foldersOrScan = yield* freshFoldersOrScan;
      const folders = Fiber.isFiber(foldersOrScan)
        ? yield* Fiber.join(foldersOrScan).pipe(
            Effect.orElseSucceed((): ReadonlyArray<HomeFolder> => []),
          )
        : foldersOrScan;
      return rankFolders(folders, input);
    },
  );

  return HomeFolderIndex.of({ search });
});

export const layer = Layer.effect(HomeFolderIndex, make);
