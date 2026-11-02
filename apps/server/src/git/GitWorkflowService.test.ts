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

const makeEmptyRepo = (prefix: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix });
    yield* runGit(cwd, ["init", "-b", "main"]);
    return cwd;
  });

const writeFile = (cwd: string, name: string, content: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(`${cwd}/${name}`, content);
  });

const readFile = (cwd: string, name: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.readFileString(`${cwd}/${name}`);
  });

const commitAll = (cwd: string, message: string) =>
  Effect.gen(function* () {
    yield* runGit(cwd, ["add", "-A"]);
    yield* runGit(cwd, [...identity, "commit", "-m", message]);
  });

const stashHash = (cwd: string, index: number) => runGit(cwd, ["rev-parse", `stash@{${index}}`]);

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
  it.effect(
    "deleteRemoteBranch should delete the branch on the remote and its tracking ref when it exists",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const { cwd } = yield* makeRepoWithUnmergedFeature("t3-delete-remote-branch-");
        yield* withBareRemote(cwd, "t3-delete-remote-branch-remote-");
        yield* runGit(cwd, ["push", "origin", "main", "feature"]);
        yield* runGit(cwd, ["remote", "set-head", "origin", "main"]);

        yield* workflow.deleteRemoteBranch({ cwd, remoteName: "origin", branchName: "feature" });

        assert.notInclude(
          yield* runGit(cwd, ["ls-remote", "--heads", "origin"]),
          "refs/heads/feature",
        );
        assert.equal(yield* runGit(cwd, ["branch", "--remotes", "--list", "origin/feature"]), "");
        assert.include(yield* runGit(cwd, ["branch", "--list", "feature"]), "feature");
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-delete-remote-branch-"))),
  );
  it.effect(
    "deleteRemoteBranch should refuse the remote's advertised default branch when the local remote HEAD points elsewhere",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const { cwd } = yield* makeRepoWithUnmergedFeature("t3-delete-remote-stale-head-");
        yield* withBareRemote(cwd, "t3-delete-remote-stale-head-remote-");
        yield* runGit(cwd, ["push", "origin", "main", "feature"]);
        yield* runGit(cwd, ["remote", "set-head", "origin", "feature"]);

        const error = yield* workflow
          .deleteRemoteBranch({ cwd, remoteName: "origin", branchName: "main" })
          .pipe(Effect.flip);

        assert.equal(error.detail, "Refusing to delete the remote's default branch.");
        assert.include(yield* runGit(cwd, ["ls-remote", "--heads", "origin"]), "refs/heads/main");
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-delete-remote-stale-head-"))),
  );
  it.effect("deleteRemoteBranch should refuse when the branch is the remote's default branch", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const { cwd } = yield* makeRepoWithUnmergedFeature("t3-delete-remote-default-");
      yield* withBareRemote(cwd, "t3-delete-remote-default-remote-");
      yield* runGit(cwd, ["push", "origin", "main"]);
      yield* runGit(cwd, ["remote", "set-head", "origin", "main"]);

      const error = yield* workflow
        .deleteRemoteBranch({ cwd, remoteName: "origin", branchName: "main" })
        .pipe(Effect.flip);

      assert.equal(error.detail, "Refusing to delete the remote's default branch.");
      assert.include(yield* runGit(cwd, ["ls-remote", "--heads", "origin"]), "refs/heads/main");
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-delete-remote-default-"))),
  );

  it.effect(
    "stage should stage a new file and unstage should return it to untracked when HEAD is unborn",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const cwd = yield* makeEmptyRepo("t3-stage-unborn-");
        yield* writeFile(cwd, "a.txt", "a");

        assert.equal(yield* runGit(cwd, ["status", "--porcelain"]), "?? a.txt");
        yield* workflow.stage({ cwd, paths: ["a.txt"] });
        assert.equal(yield* runGit(cwd, ["status", "--porcelain"]), "A  a.txt");
        yield* workflow.unstage({ cwd, paths: ["a.txt"] });
        assert.equal(yield* runGit(cwd, ["status", "--porcelain"]), "?? a.txt");
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-stage-unborn-"))),
  );
  it.effect(
    "unstage should return a partially staged new file to untracked and keep its edit when HEAD is unborn",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const cwd = yield* makeEmptyRepo("t3-unstage-unborn-am-");
        yield* writeFile(cwd, "a.txt", "a");
        yield* workflow.stage({ cwd, paths: ["a.txt"] });
        yield* writeFile(cwd, "a.txt", "a2");
        assert.equal(yield* runGit(cwd, ["status", "--porcelain"]), "AM a.txt");

        yield* workflow.unstage({ cwd, paths: ["a.txt"] });

        assert.equal(yield* runGit(cwd, ["status", "--porcelain"]), "?? a.txt");
        assert.equal(yield* readFile(cwd, "a.txt"), "a2");
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-unstage-unborn-am-"))),
  );
  it.effect(
    "stage and unstage should succeed when the path list is larger than the process argument limit",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const cwd = yield* makeEmptyRepo("t3-stage-many-");
        yield* writeFile(cwd, "a.txt", "v1");
        yield* commitAll(cwd, "first");
        const name = `${"n".repeat(200)}.txt`;
        yield* writeFile(cwd, name, "new");
        yield* writeFile(cwd, "a.txt", "v2");
        // Repeated pathspecs push argv past ARG_MAX (1 MiB on macOS, 2 MiB on Linux).
        const paths = [...Array.from({ length: 20_000 }, () => name), "a.txt"];

        yield* workflow.stage({ cwd, paths });
        assert.equal(yield* runGit(cwd, ["status", "--porcelain"]), `M  a.txt\nA  ${name}`);

        yield* workflow.unstage({ cwd, paths });
        assert.equal(yield* runGit(cwd, ["status", "--porcelain"]), `M a.txt\n?? ${name}`);
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-stage-many-"))),
  );
  it.effect("unstage should keep the worktree edit when a staged modification is unstaged", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const cwd = yield* makeEmptyRepo("t3-unstage-edit-");
      yield* writeFile(cwd, "a.txt", "v1");
      yield* commitAll(cwd, "first");
      yield* writeFile(cwd, "a.txt", "v2");
      yield* workflow.stage({ cwd, paths: ["a.txt"] });

      yield* workflow.unstage({ cwd, paths: ["a.txt"] });

      assert.equal(yield* runGit(cwd, ["status", "--porcelain"]), "M a.txt");
      assert.equal(yield* readFile(cwd, "a.txt"), "v2");
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-unstage-edit-"))),
  );
  it.effect(
    "discard should restore the staged version and delete untracked files when paths mix both",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const cwd = yield* makeEmptyRepo("t3-discard-mixed-");
        yield* writeFile(cwd, "a.txt", "v1");
        yield* commitAll(cwd, "first");
        yield* writeFile(cwd, "a.txt", "v2");
        yield* runGit(cwd, ["add", "a.txt"]);
        yield* writeFile(cwd, "a.txt", "v3");
        yield* writeFile(cwd, "new.txt", "new");

        yield* workflow.discard({ cwd, paths: ["a.txt", "new.txt"] });

        assert.equal(yield* readFile(cwd, "a.txt"), "v2");
        assert.equal(yield* runGit(cwd, ["status", "--porcelain"]), "M  a.txt");
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-discard-mixed-"))),
  );
  it.effect(
    "discardAll should reset tracked and staged changes and keep ignored files when run",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const cwd = yield* makeEmptyRepo("t3-discard-all-");
        yield* writeFile(cwd, ".gitignore", "ignored.txt\n");
        yield* writeFile(cwd, "a.txt", "v1");
        yield* commitAll(cwd, "first");
        yield* writeFile(cwd, "a.txt", "v2");
        yield* runGit(cwd, ["add", "a.txt"]);
        yield* writeFile(cwd, "a.txt", "v3");
        yield* writeFile(cwd, "new.txt", "new");
        yield* writeFile(cwd, "ignored.txt", "keep");

        yield* workflow.discardAll({ cwd });

        assert.equal(yield* readFile(cwd, "a.txt"), "v1");
        assert.equal(yield* readFile(cwd, "ignored.txt"), "keep");
        assert.equal(yield* runGit(cwd, ["status", "--porcelain"]), "");
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-discard-all-"))),
  );
  it.effect("discard should fail and keep the directory when the path is a nested repository", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const cwd = yield* makeEmptyRepo("t3-discard-nested-");
      yield* writeFile(cwd, "a.txt", "v1");
      yield* commitAll(cwd, "first");
      yield* runGit(cwd, ["init", "-q", "nested"]);
      yield* writeFile(cwd, "nested/x.txt", "x");

      const error = yield* workflow.discard({ cwd, paths: ["nested/"] }).pipe(Effect.flip);

      assert.equal(error.detail, "Nested Git repositories are not discarded.");
      assert.equal(yield* readFile(cwd, "nested/x.txt"), "x");
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-discard-nested-"))),
  );
  it.effect(
    "discardAll should discard everything else and then fail when a nested repository remains",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const cwd = yield* makeEmptyRepo("t3-discard-all-nested-");
        yield* writeFile(cwd, "a.txt", "v1");
        yield* commitAll(cwd, "first");
        yield* writeFile(cwd, "a.txt", "v2");
        yield* writeFile(cwd, "new.txt", "new");
        yield* runGit(cwd, ["init", "-q", "nested"]);
        yield* writeFile(cwd, "nested/x.txt", "x");

        const error = yield* workflow.discardAll({ cwd }).pipe(Effect.flip);

        assert.equal(error.detail, "Nested Git repositories were left in place.");
        assert.equal(yield* readFile(cwd, "a.txt"), "v1");
        assert.equal(yield* runGit(cwd, ["status", "--porcelain"]), "?? nested/");
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-discard-all-nested-"))),
  );
  it.effect("stashPush should include untracked files when a message is given", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const cwd = yield* makeEmptyRepo("t3-stash-push-");
      yield* writeFile(cwd, "a.txt", "v1");
      yield* commitAll(cwd, "first");
      yield* writeFile(cwd, "a.txt", "v2");
      yield* writeFile(cwd, "new.txt", "new");

      yield* workflow.stashPush({ cwd, message: "my stash" });

      assert.include(yield* runGit(cwd, ["stash", "list"]), "my stash");
      assert.equal(yield* runGit(cwd, ["status", "--porcelain"]), "");
      assert.equal(yield* readFile(cwd, "a.txt"), "v1");
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-stash-push-"))),
  );
  it.effect(
    "stashAction should refuse pop when the stash at the index no longer has the given hash",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const cwd = yield* makeEmptyRepo("t3-stash-moved-");
        yield* writeFile(cwd, "a.txt", "v1");
        yield* commitAll(cwd, "first");
        yield* writeFile(cwd, "a.txt", "v2");
        yield* workflow.stashPush({ cwd, message: "one" });
        const staleHash = yield* stashHash(cwd, 0);
        yield* writeFile(cwd, "a.txt", "v3");
        yield* workflow.stashPush({ cwd, message: "two" });

        const error = yield* workflow
          .stashAction({ cwd, action: "pop", index: 0, hash: staleHash })
          .pipe(Effect.flip);

        assert.equal(error._tag, "GitStashMovedError");
        assert.equal((yield* runGit(cwd, ["stash", "list"])).split("\n").length, 2);
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-stash-moved-"))),
  );
  it.effect(
    "stashAction should drop exactly that stash and refuse a stale hash when action is drop",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const cwd = yield* makeEmptyRepo("t3-stash-drop-");
        yield* writeFile(cwd, "a.txt", "v1");
        yield* commitAll(cwd, "first");
        yield* writeFile(cwd, "a.txt", "v2");
        yield* workflow.stashPush({ cwd, message: "one" });
        const staleHash = yield* stashHash(cwd, 0);
        yield* writeFile(cwd, "a.txt", "v3");
        yield* workflow.stashPush({ cwd, message: "two" });
        const topHash = yield* stashHash(cwd, 0);

        const error = yield* workflow
          .stashAction({ cwd, action: "drop", index: 0, hash: staleHash })
          .pipe(Effect.flip);
        assert.equal(error._tag, "GitStashMovedError");
        assert.equal((yield* runGit(cwd, ["stash", "list"])).split("\n").length, 2);

        yield* workflow.stashAction({ cwd, action: "drop", index: 0, hash: topHash });
        const remaining = yield* runGit(cwd, ["stash", "list"]);
        assert.include(remaining, "one");
        assert.notInclude(remaining, "two");
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-stash-drop-"))),
  );
  it.effect("stashAction should report a conflict and keep the stash when pop conflicts", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const cwd = yield* makeEmptyRepo("t3-stash-conflict-");
      yield* writeFile(cwd, "a.txt", "v1");
      yield* commitAll(cwd, "first");
      yield* writeFile(cwd, "a.txt", "stashed");
      yield* workflow.stashPush({ cwd, message: "conflicting" });
      yield* writeFile(cwd, "a.txt", "committed");
      yield* commitAll(cwd, "second");
      const hash = yield* stashHash(cwd, 0);

      const error = yield* workflow
        .stashAction({ cwd, action: "pop", index: 0, hash })
        .pipe(Effect.flip);

      assert.equal(error._tag, "GitStashConflictError");
      assert.equal(error._tag === "GitStashConflictError" ? error.action : null, "pop");
      assert.equal((yield* runGit(cwd, ["stash", "list"])).split("\n").length, 1);
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-stash-conflict-"))),
  );
  it.effect(
    "stashAction should fail with GitStashPartiallyAppliedError and keep the stash when a stashed new file already exists",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const cwd = yield* makeEmptyRepo("t3-stash-partial-");
        yield* writeFile(cwd, "f.txt", "v1");
        yield* commitAll(cwd, "first");
        yield* writeFile(cwd, "f.txt", "stashed");
        yield* writeFile(cwd, "u.txt", "stashed new");
        yield* workflow.stashPush({ cwd });
        yield* writeFile(cwd, "u.txt", "mine");
        const hash = yield* stashHash(cwd, 0);

        const error = yield* workflow
          .stashAction({ cwd, action: "pop", index: 0, hash })
          .pipe(Effect.flip);

        assert.equal(error._tag, "GitStashPartiallyAppliedError");
        assert.equal(error._tag === "GitStashPartiallyAppliedError" ? error.action : null, "pop");
        assert.equal(yield* readFile(cwd, "f.txt"), "stashed");
        assert.equal(yield* readFile(cwd, "u.txt"), "mine");
        assert.equal(yield* stashHash(cwd, 0), hash);
      }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-stash-partial-"))),
  );
  it.effect("stashAction should apply by hash and keep the stash when action is apply", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const cwd = yield* makeEmptyRepo("t3-stash-apply-");
      yield* writeFile(cwd, "a.txt", "v1");
      yield* commitAll(cwd, "first");
      yield* writeFile(cwd, "a.txt", "v2");
      yield* workflow.stashPush({ cwd });
      const hash = yield* stashHash(cwd, 0);

      yield* workflow.stashAction({ cwd, action: "apply", index: 0, hash });

      assert.equal(yield* readFile(cwd, "a.txt"), "v2");
      assert.equal((yield* runGit(cwd, ["stash", "list"])).split("\n").length, 1);
    }).pipe(Effect.scoped, Effect.provide(workflowLayer("t3-stash-apply-"))),
  );
});
