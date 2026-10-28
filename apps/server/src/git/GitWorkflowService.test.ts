import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";

import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitManager from "./GitManager.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";
import * as WorktreeRemoveScripts from "../project/WorktreeRemoveScripts.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";

const noRemoveScripts: WorktreeRemoveScripts.WorktreeRemoveScripts["Service"] = {
  runBeforeRemove: () => Effect.void,
};

const workflowLayer = (
  prefix: string,
  removeScripts: WorktreeRemoveScripts.WorktreeRemoveScripts["Service"] = noRemoveScripts,
) =>
  GitWorkflowService.layer.pipe(
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        resolve: ({ cwd }) =>
          Effect.succeed({
            kind: "git",
            repository: { rootPath: cwd },
          } as VcsDriverRegistry.VcsDriverHandle),
        detect: () => Effect.succeed({ kind: "git" } as VcsDriverRegistry.VcsDriverHandle),
      }),
    ),
    Layer.provide(Layer.mock(GitManager.GitManager)({})),
    Layer.provide(Layer.succeed(WorktreeRemoveScripts.WorktreeRemoveScripts, removeScripts)),
    Layer.provideMerge(GitVcsDriver.layer),
    Layer.provideMerge(VcsProcess.layer),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix }).pipe(Layer.provide(NodeServices.layer)),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

const identity = ["-c", "user.email=t@t", "-c", "user.name=t"];

const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    const result = yield* driver.execute({ operation: "test.git", cwd, args });
    return result.stdout.trim();
  });

const commitOnTop = (cwd: string, message: string) =>
  runGit(cwd, [...identity, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", message]);

/** A repository on `main` with two commits; `feature` holds a third that `main` lacks. */
const makeRepoWithUnmergedFeature = (prefix: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix });
    yield* runGit(cwd, ["init", "-b", "main"]);
    yield* runGit(cwd, [...identity, "commit", "--allow-empty", "-m", "first"]);
    const firstCommit = yield* runGit(cwd, ["rev-parse", "HEAD"]);
    yield* runGit(cwd, [...identity, "commit", "--allow-empty", "-m", "second"]);
    yield* runGit(cwd, ["update-ref", "refs/heads/feature", yield* commitOnTop(cwd, "feature")]);
    return { cwd, firstCommit };
  });

const withBareRemote = (cwd: string, prefix: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const remote = yield* fileSystem.makeTempDirectoryScoped({ prefix });
    yield* runGit(remote, ["init", "--bare", "-b", "main"]);
    yield* runGit(cwd, ["remote", "add", "origin", remote]);
  });

it.layer(NodeServices.layer)("GitWorkflowService", (it) => {
  it.effect("runs the project's removal action while the worktree still exists", () => {
    const calls: Array<{
      input: WorktreeRemoveScripts.WorktreeRemoveScriptInput;
      existed: boolean;
    }> = [];
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-remove-repo-" });
      const worktrees = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-remove-wt-" });
      const worktreePath = `${worktrees}/feature`;
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      for (const args of [
        ["init", "-b", "main"],
        ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"],
        ["worktree", "add", "-b", "feature", worktreePath],
      ]) {
        yield* driver.execute({ operation: "test.setupRepo", cwd, args });
      }

      yield* workflow.removeWorktree({ cwd, path: worktreePath, force: true });

      assert.deepEqual(calls, [{ input: { projectRoot: cwd, worktreePath }, existed: true }]);
      assert.isFalse(yield* fileSystem.exists(worktreePath));
    }).pipe(
      Effect.scoped,
      Effect.provide(
        workflowLayer("t3-remove-", {
          runBeforeRemove: (input) =>
            Effect.gen(function* () {
              const fileSystem = yield* FileSystem.FileSystem;
              calls.push({
                input,
                existed: yield* fileSystem.exists(input.worktreePath).pipe(Effect.orDie),
              });
            }).pipe(Effect.provide(NodeServices.layer)),
        }),
      ),
    );
  });
  it.effect("finds a name among the refs of every namespace", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-ref-named-" });
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      for (const args of [
        ["init", "-b", "main"],
        ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"],
        ["update-ref", "refs/remotes/upstream/feature/topic", "HEAD"],
        ["symbolic-ref", "refs/remotes/origin/alias", "refs/heads/main"],
        ["update-ref", "refs/mirror/origin/mirrored", "HEAD"],
      ]) {
        yield* driver.execute({ operation: "test.setupRepo", cwd, args });
      }
      const found = yield* Effect.forEach(
        ["main", "feature/topic", "alias", "mirrored", "t3/renamed", "feature/*"],
        (refName) => workflow.hasRefNamed({ cwd, refName }),
      );
      assert.deepEqual(found, [true, true, true, true, false, false]);
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-ref-named-"))),
  );
  it.effect("fetches the primary remote, pruning deleted branches and listing new ones", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fetch-repo-" });
      const remote = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fetch-remote-" });
      const peer = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fetch-peer-" });
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      const git = (at: string, args: ReadonlyArray<string>) =>
        driver.execute({ operation: "test.fetch", cwd: at, args });
      const identity = ["-c", "user.email=t@t", "-c", "user.name=t"];
      yield* git(remote, ["init", "--bare", "-b", "main"]);
      yield* git(cwd, ["init", "-b", "main"]);
      yield* git(cwd, [...identity, "commit", "--allow-empty", "-m", "init"]);
      yield* git(cwd, ["remote", "add", "origin", remote]);
      yield* git(cwd, ["push", "origin", "main", "main:gone"]);
      yield* git(peer, ["clone", remote, "."]);
      yield* git(peer, ["push", "origin", "main:feature-x", ":gone"]);
      const before = yield* workflow.listRefs({ cwd });
      assert.include(
        before.refs.map((ref) => ref.name),
        "origin/gone",
      );

      assert.deepEqual(yield* workflow.fetch({ cwd }), { remoteName: "origin" });

      const after = yield* workflow.listRefs({ cwd });
      const remoteOnly = after.refs.find((ref) => ref.name === "origin/feature-x");
      assert.equal(remoteOnly?.isRemote, true);
      assert.notInclude(
        after.refs.map((ref) => ref.name),
        "origin/gone",
      );
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-fetch-"))),
  );
  it.effect(
    "deleteBranch should fail with GitBranchNotFullyMergedError when the branch has unmerged commits",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const { cwd } = yield* makeRepoWithUnmergedFeature("t3-delete-unmerged-");

        const error = yield* workflow.deleteBranch({ cwd, refName: "feature" }).pipe(Effect.flip);

        assert.equal(error._tag, "GitBranchNotFullyMergedError");
        assert.deepInclude(error, { cwd, branch: "feature" });
        assert.include(yield* runGit(cwd, ["branch", "--list", "feature"]), "feature");
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-delete-unmerged-"))),
  );
  it.effect(
    "deleteBranch should delete the branch when force is true and it has unmerged commits",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const { cwd } = yield* makeRepoWithUnmergedFeature("t3-delete-force-");

        yield* workflow.deleteBranch({ cwd, refName: "feature", force: true });

        assert.equal(yield* runGit(cwd, ["branch", "--list", "feature"]), "");
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-delete-force-"))),
  );
  it.effect(
    "renameLocalBranch should fail instead of adding a suffix when the new name already exists",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const { cwd } = yield* makeRepoWithUnmergedFeature("t3-rename-taken-");

        const error = yield* workflow
          .renameLocalBranch({ cwd, oldName: "main", newName: "feature" })
          .pipe(Effect.flip);

        assert.equal(error._tag, "GitCommandError");
        assert.deepEqual(
          (yield* runGit(cwd, ["branch", "--format=%(refname:short)"])).split("\n"),
          ["feature", "main"],
        );
        assert.deepEqual(
          yield* workflow.renameLocalBranch({ cwd, oldName: "main", newName: "trunk" }),
          { refName: "trunk" },
        );
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-rename-taken-"))),
  );
  it.effect("createTag should create a lightweight tag at the target commit", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const { cwd, firstCommit } = yield* makeRepoWithUnmergedFeature("t3-create-tag-");

      yield* workflow.createTag({ cwd, tagName: "v1.0", target: firstCommit });

      assert.equal(yield* runGit(cwd, ["cat-file", "-t", "refs/tags/v1.0"]), "commit");
      assert.equal(yield* runGit(cwd, ["rev-parse", "refs/tags/v1.0"]), firstCommit);
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-create-tag-"))),
  );
  it.effect("createTag should reject a name starting with a dash", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const { cwd, firstCommit } = yield* makeRepoWithUnmergedFeature("t3-dash-tag-");

      const errors = yield* Effect.forEach(["-d", "bad..name"], (tagName) =>
        workflow.createTag({ cwd, tagName, target: firstCommit }).pipe(Effect.flip),
      );

      assert.deepEqual(
        errors.map((error) => error.detail),
        ["Not a valid tag name.", "Not a valid tag name."],
      );
      assert.equal(yield* runGit(cwd, ["tag", "--list"]), "");
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-dash-tag-"))),
  );
  it.effect("deleteTag should remove only the local tag when the remote has it too", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const { cwd } = yield* makeRepoWithUnmergedFeature("t3-delete-tag-");
      yield* withBareRemote(cwd, "t3-delete-tag-remote-");
      yield* runGit(cwd, ["tag", "v1.0"]);
      yield* runGit(cwd, ["push", "origin", "refs/tags/v1.0"]);

      yield* workflow.deleteTag({ cwd, tagName: "v1.0" });

      assert.equal(yield* runGit(cwd, ["tag", "--list"]), "");
      assert.include(yield* runGit(cwd, ["ls-remote", "--tags", "origin"]), "refs/tags/v1.0");
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-delete-tag-"))),
  );
  it.effect("pushTag should push the tag to the named remote when the remote exists", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const { cwd, firstCommit } = yield* makeRepoWithUnmergedFeature("t3-push-tag-");
      yield* withBareRemote(cwd, "t3-push-tag-remote-");
      yield* runGit(cwd, ["tag", "v1.0", firstCommit]);

      yield* workflow.pushTag({ cwd, tagName: "v1.0", remoteName: "origin" });

      assert.equal(yield* runGit(cwd, ["ls-remote", "origin"]), `${firstCommit}\trefs/tags/v1.0`);
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-push-tag-"))),
  );
  it.effect("pushTag should fail when the remote is unknown", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const { cwd } = yield* makeRepoWithUnmergedFeature("t3-push-tag-unknown-");
      yield* withBareRemote(cwd, "t3-push-tag-unknown-remote-");
      yield* runGit(cwd, ["tag", "v1.0"]);

      const error = yield* workflow
        .pushTag({ cwd, tagName: "v1.0", remoteName: "upstream" })
        .pipe(Effect.flip);

      assert.equal(error.detail, "Unknown remote.");
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-push-tag-unknown-"))),
  );
});
