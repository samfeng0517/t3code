import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { makeWorktreeThreadMatcher } from "./worktreesDirectory.ts";

it.layer(NodeServices.layer)("makeWorktreeThreadMatcher", (it) => {
  it.effect(
    "should match every spelling of the same checkout when threads recorded it through a symlink or with a trailing separator",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        // The temp root itself sits behind a symlink on macOS, like a symlinked T3 home.
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-worktree-match-" });
        const real = path.join(root, "real");
        const link = path.join(root, "link");
        yield* fs.makeDirectory(path.join(real, "wt"), { recursive: true });
        yield* fs.makeDirectory(path.join(real, "other"), { recursive: true });
        yield* fs.symlink(real, link);
        const match = yield* makeWorktreeThreadMatcher;

        const threadIds = yield* match(yield* fs.realPath(path.join(real, "wt")), [
          { threadId: "via-link", worktreePath: path.join(link, "wt") },
          { threadId: "trailing", worktreePath: `${path.join(real, "wt")}/` },
          { threadId: "other", worktreePath: path.join(real, "other") },
        ]);
        assert.deepStrictEqual(threadIds, ["via-link", "trailing"]);
      }),
  );

  it.effect(
    "should match a removed worktree through its nearest existing parent when the folder is gone",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-worktree-gone-" });
        const real = path.join(root, "real");
        const link = path.join(root, "link");
        yield* fs.makeDirectory(real, { recursive: true });
        yield* fs.symlink(real, link);
        const match = yield* makeWorktreeThreadMatcher;

        const threadIds = yield* match(path.join(real, "gone"), [
          { threadId: "gone", worktreePath: path.join(link, "gone") },
          { threadId: "sibling", worktreePath: path.join(link, "gone-too") },
        ]);
        assert.deepStrictEqual(threadIds, ["gone"]);
      }),
  );
});
