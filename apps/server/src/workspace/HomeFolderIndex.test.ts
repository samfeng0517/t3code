// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vite-plus/test";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as HomeFolderIndex from "./HomeFolderIndex.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

const actualReaddir = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"))
  .readdir;

const makeHome = Effect.fn(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-home-folder-index-" });
});

const makeFolders = Effect.fn(function* (home: string, relativePaths: ReadonlyArray<string>) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const relativePath of relativePaths) {
    yield* fileSystem.makeDirectory(path.join(home, ...relativePath.split("/")), {
      recursive: true,
    });
  }
});

const makeIndex = (home: string) =>
  HomeFolderIndex.make.pipe(Effect.provideService(HostProcess.HomeDirectory, home));

const searchPaths = Effect.fn(function* (
  index: HomeFolderIndex.HomeFolderIndex["Service"],
  query: string,
  limit = 50,
) {
  const result = yield* index.search({ query, limit });
  return result.entries.map((entry) => entry.homeRelativePath);
});

it.layer(NodeServices.layer)("HomeFolderIndex", (it) => {
  describe("search", () => {
    it.effect(
      "should find a folder two levels below home when the query matches its name exactly",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const home = yield* makeHome();
          yield* makeFolders(home, ["Documents/app_ttw"]);
          const index = yield* makeIndex(home);

          const result = yield* index.search({ query: "app_ttw", limit: 10 });

          expect(result.entries).toEqual([
            {
              name: "app_ttw",
              fullPath: path.join(home, "Documents", "app_ttw"),
              homeRelativePath: "Documents/app_ttw",
            },
          ]);
        }),
    );

    it.effect(
      "should rank exact, prefix, segment and contains matches in that order when names tie on tier",
      () =>
        Effect.gen(function* () {
          const home = yield* makeHome();
          yield* makeFolders(home, [
            "happy",
            "my-app",
            "Work/apple",
            "Documents/appa",
            "appz",
            "Documents/app",
          ]);
          const index = yield* makeIndex(home);

          expect(yield* searchPaths(index, "app")).toEqual([
            "Documents/app",
            "appz",
            "Documents/appa",
            "Work/apple",
            "my-app",
            "happy",
          ]);
        }),
    );

    it.effect("should not match by contains when the query is shorter than 3 characters", () =>
      Effect.gen(function* () {
        const home = yield* makeHome();
        yield* makeFolders(home, ["Documents/app_ttw"]);
        const index = yield* makeIndex(home);

        expect(yield* searchPaths(index, "tw")).toEqual([]);
        expect(yield* searchPaths(index, "ttw")).toEqual(["Documents/app_ttw"]);
        expect(yield* searchPaths(index, "attw")).toEqual([]);
      }),
    );

    it.effect(
      "should record a git repository folder but not its subfolders when a folder contains .git",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const home = yield* makeHome();
          yield* makeFolders(home, ["repo/.git", "repo/lib", "Work/worktree/lib"]);
          yield* fileSystem.writeFileString(path.join(home, "Work", "worktree", ".git"), "gitdir");
          yield* fileSystem.makeDirectory(path.join(home, ".git"));
          const index = yield* makeIndex(home);

          expect(yield* searchPaths(index, "repo")).toEqual(["repo"]);
          expect(yield* searchPaths(index, "worktree")).toEqual(["Work/worktree"]);
          expect(yield* searchPaths(index, "lib")).toEqual([]);
        }),
    );

    it.effect(
      "should skip dot folders, Library, node_modules and other skipped names when scanning",
      () =>
        Effect.gen(function* () {
          const home = yield* makeHome();
          const skipped = [
            "Library",
            "node_modules",
            "Applications",
            "Pictures",
            "Music",
            "Movies",
            "AppData",
          ];
          yield* makeFolders(home, [
            ".config/target",
            ...skipped.map((name) => `${name}/target`),
            "Documents/node_modules/target",
            "Libraries/target",
          ]);
          const index = yield* makeIndex(home);

          expect(yield* searchPaths(index, "config")).toEqual([]);
          for (const name of skipped) {
            expect(yield* searchPaths(index, name)).toEqual([]);
          }
          expect(yield* searchPaths(index, "target")).toEqual(["Libraries/target"]);
        }),
    );

    it.effect("should not record folders deeper than 4 levels when scanning", () =>
      Effect.gen(function* () {
        const home = yield* makeHome();
        yield* makeFolders(home, ["one/two/three/four/five"]);
        const index = yield* makeIndex(home);

        expect(yield* searchPaths(index, "four")).toEqual(["one/two/three/four"]);
        expect(yield* searchPaths(index, "five")).toEqual([]);
      }),
    );

    it.effect("should not follow symlinked folders when scanning", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* makeHome();
        yield* makeFolders(home, ["real/inner"]);
        yield* fileSystem.symlink(path.join(home, "real"), path.join(home, "linked"));
        const index = yield* makeIndex(home);

        expect(yield* searchPaths(index, "linked")).toEqual([]);
        expect(yield* searchPaths(index, "inner")).toEqual(["real/inner"]);
      }),
    );

    it.effect("should return at most limit entries when more folders match", () =>
      Effect.gen(function* () {
        const home = yield* makeHome();
        yield* makeFolders(home, ["app1", "app2", "app3", "app4"]);
        const index = yield* makeIndex(home);

        expect(yield* searchPaths(index, "app", 2)).toEqual(["app1", "app2"]);
      }),
    );

    it.effect(
      "should include a folder created after the first scan when the snapshot is older than 5 minutes",
      () =>
        Effect.gen(function* () {
          const home = yield* makeHome();
          yield* makeFolders(home, ["first"]);
          const index = yield* makeIndex(home);

          expect(yield* searchPaths(index, "first")).toEqual(["first"]);
          yield* makeFolders(home, ["second"]);
          expect(yield* searchPaths(index, "second")).toEqual([]);

          yield* TestClock.adjust("5 minutes");

          expect(yield* searchPaths(index, "second")).toEqual(["second"]);
        }),
    );

    it.effect(
      "should return empty entries and retry on the next search when home cannot be read",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const parent = yield* makeHome();
          const home = path.join(parent, "missing-home");
          const index = yield* makeIndex(home);

          expect(yield* searchPaths(index, "projects")).toEqual([]);
          yield* makeFolders(home, ["projects"]);

          expect(yield* searchPaths(index, "projects")).toEqual(["projects"]);
        }),
    );

    it.effect("should finish the scan and reuse it when the first search is interrupted", () =>
      Effect.gen(function* () {
        const home = yield* makeHome();
        yield* makeFolders(home, ["projects"]);
        const readdirMock = vi.mocked(NodeFSP.readdir);
        readdirMock.mockClear();
        const homeReadEntered = yield* Deferred.make<void>();
        const homeReadGate = Promise.withResolvers<void>();
        readdirMock.mockImplementationOnce((async (...args: Parameters<typeof actualReaddir>) => {
          Deferred.doneUnsafe(homeReadEntered, Effect.void);
          await homeReadGate.promise;
          return actualReaddir(...args);
        }) as typeof actualReaddir);
        const index = yield* makeIndex(home);

        const firstSearch = yield* Effect.forkChild(searchPaths(index, "projects"));
        yield* Deferred.await(homeReadEntered);
        const concurrentSearch = yield* Effect.forkChild(searchPaths(index, "projects"));
        yield* Fiber.interrupt(firstSearch);
        homeReadGate.resolve();

        expect(yield* Fiber.join(concurrentSearch)).toEqual(["projects"]);
        expect(yield* searchPaths(index, "projects")).toEqual(["projects"]);
        const homeReads = readdirMock.mock.calls.filter(([directory]) => directory === home);
        expect(homeReads).toHaveLength(1);
      }),
    );
  });
});
