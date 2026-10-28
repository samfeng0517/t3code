import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  gitignoreLiteralPattern,
  makeWorktreePopulator,
  type WorktreePopulationDeps,
} from "./worktreePopulation.ts";

const setup = Effect.fn("setup")(function* (files: Record<string, string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-populate-repo-" });
  const worktreePath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-populate-wt-" });
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(repoRoot, relativePath);
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
    yield* fs.writeFileString(filePath, contents);
  }
  const platform = yield* HostProcess.Platform;
  const checked: Array<ReadonlyArray<string>> = [];
  const populate = (overrides: Partial<WorktreePopulationDeps> = {}) =>
    makeWorktreePopulator({
      fileSystem: fs,
      path,
      platform,
      checkIgnore: (_root, paths) =>
        Effect.sync(() => {
          checked.push(paths);
          return new Set(paths);
        }),
      submodulePaths: () => Effect.succeed([]),
      excludeLocally: () => Effect.void,
      ...overrides,
    })({ repoRoot, worktreePath });
  return { fs, path, repoRoot, worktreePath, checked, populate };
});

describe("makeWorktreePopulator", () => {
  it.effect("checks each entry against the budget, so smaller later entries still copy", () =>
    Effect.gen(function* () {
      const { fs, path, worktreePath, populate } = yield* setup({
        ".worktreeinclude": "big.env\nsmall.env\n",
        "big.env": "x".repeat(100),
        "small.env": "tiny",
      });
      const result = yield* populate({ copyBudget: { bytes: 10, entries: 10 } });
      assert.deepEqual(result, {
        linked: [],
        copied: ["small.env"],
        skipped: [{ path: "big.env", reason: "over-budget" }],
      });
      assert.isFalse(yield* fs.exists(path.join(worktreePath, "big.env")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("never writes through a symlinked folder on the branch", () =>
    Effect.gen(function* () {
      const { fs, path, worktreePath, populate } = yield* setup({
        ".worktreeinclude": "conf/local.json\nsafe.env\n",
        "conf/local.json": "{}",
        "safe.env": "A=1",
      });
      const outside = yield* fs.makeTempDirectoryScoped({ prefix: "t3-populate-outside-" });
      yield* fs.symlink(outside, path.join(worktreePath, "conf"));
      const result = yield* populate();
      assert.deepEqual(result.skipped, [{ path: "conf/local.json", reason: "outside-worktree" }]);
      assert.deepEqual(result.copied, ["safe.env"]);
      assert.deepEqual(yield* fs.readDirectory(outside), []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("skips paths behind a symlink or in a submodule before asking git", () =>
    Effect.gen(function* () {
      const { fs, path, repoRoot, checked, populate } = yield* setup({
        ".worktreeinclude": "linked/secret.env\nvendor/lib/.env\n.env\n",
        ".env": "A=1",
        "vendor/lib/.env": "B=2",
      });
      const target = yield* fs.makeTempDirectoryScoped({ prefix: "t3-populate-target-" });
      yield* fs.writeFileString(path.join(target, "secret.env"), "S=1");
      yield* fs.symlink(target, path.join(repoRoot, "linked"));
      const result = yield* populate({ submodulePaths: () => Effect.succeed(["vendor/lib"]) });
      assert.deepEqual(result.copied, [".env"]);
      assert.deepEqual(result.skipped, [
        { path: "linked/secret.env", reason: "unsupported-path" },
        { path: "vendor/lib/.env", reason: "unsupported-path" },
      ]);
      assert.deepEqual(checked, [[".env"]]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("checks entries one by one when git refuses the batch", () =>
    Effect.gen(function* () {
      const { populate } = yield* setup({
        ".worktreeinclude": "a.env\nbad.env\nb.env\n",
        "a.env": "A",
        "bad.env": "B",
        "b.env": "C",
      });
      const result = yield* populate({
        checkIgnore: (_root, paths) =>
          Effect.succeed(paths.length > 1 || paths[0] === "bad.env" ? null : new Set(paths)),
      });
      assert.deepEqual(result.copied, ["a.env", "b.env"]);
      assert.deepEqual(result.skipped, [{ path: "bad.env", reason: "unchecked" }]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("gitignoreLiteralPattern", () => {
  it("anchors the entry and escapes pattern characters and trailing spaces", () => {
    assert.equal(gitignoreLiteralPattern(".cache"), "/.cache");
    assert.equal(gitignoreLiteralPattern("#notes"), "/#notes");
    assert.equal(gitignoreLiteralPattern("!keep"), "/!keep");
    assert.equal(gitignoreLiteralPattern("a[1]/b*?\\c"), "/a\\[1]/b\\*\\?\\\\c");
    assert.equal(gitignoreLiteralPattern("dir  "), "/dir\\ \\ ");
  });
});
