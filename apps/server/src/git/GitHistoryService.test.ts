import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as GitHistoryService from "./GitHistoryService.ts";

const historyLayer = (workspaceRoot: string) =>
  GitHistoryService.layer.pipe(
    Layer.provide(
      Layer.mock(KnownWorkspaces.KnownWorkspaces)({
        contains: () => Effect.succeed(false),
      }),
    ),
    Layer.provide(VcsDriverRegistry.layer),
    Layer.provideMerge(GitVcsDriver.layer),
    Layer.provideMerge(VcsProcess.layer),
    Layer.provideMerge(
      ServerConfig.layerTest(workspaceRoot, { prefix: "t3-history-base-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

const identity = ["-c", "user.email=t@t", "-c", "user.name=t"];

/** Runs `body` with a fresh workspace root (a real path) that bounds the service. */
const inWorkspace = <A, E>(
  body: (
    workspace: string,
  ) => Effect.Effect<
    A,
    E,
    | GitHistoryService.GitHistoryService
    | GitVcsDriver.GitVcsDriver
    | Crypto.Crypto
    | FileSystem.FileSystem
    | Path.Path
  >,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const workspace = yield* fs.realPath(
      yield* fs.makeTempDirectoryScoped({ prefix: "t3-history-workspace-" }),
    );
    return yield* body(workspace).pipe(Effect.provide(historyLayer(workspace)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const gitIn = Effect.fn("test.git")(function* (
  cwd: string,
  args: ReadonlyArray<string>,
  stdin?: string,
) {
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const result = yield* driver.execute({
    operation: "test.git",
    cwd,
    args,
    ...(stdin === undefined ? {} : { stdin }),
  });
  return result.stdout.trim();
});

const commit = (cwd: string, message: string) =>
  gitIn(cwd, [...identity, "commit", "--allow-empty", "-m", message]).pipe(
    Effect.andThen(gitIn(cwd, ["rev-parse", "HEAD"])),
  );

const writeFile = Effect.fn("test.writeFile")(function* (
  repo: string,
  relativePath: string,
  contents: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.writeFileString(path.join(repo, relativePath), contents);
});

const writeAndAdd = (repo: string, relativePath: string, contents: string) =>
  writeFile(repo, relativePath, contents).pipe(
    Effect.andThen(gitIn(repo, ["add", "--", relativePath])),
  );

const makeRepo = Effect.fn("test.makeRepo")(function* (workspace: string, name = "repo") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repo = path.join(workspace, name);
  yield* fs.makeDirectory(repo);
  yield* gitIn(repo, ["init", "-b", "main"]);
  return repo;
});

describe("GitHistoryService", () => {
  it.effect(
    "logPage should return commits in topo order with parents when the history has a merge",
    () =>
      inWorkspace((workspace) =>
        Effect.gen(function* () {
          const repo = yield* makeRepo(workspace);
          const root = yield* commit(repo, "root");
          yield* gitIn(repo, ["switch", "-c", "feature"]);
          const side = yield* commit(repo, "side");
          yield* gitIn(repo, ["switch", "main"]);
          const mainline = yield* commit(repo, "mainline");
          yield* gitIn(repo, [...identity, "merge", "--no-ff", "-m", "merge feature", "feature"]);
          const merge = yield* gitIn(repo, ["rev-parse", "HEAD"]);

          const history = yield* GitHistoryService.GitHistoryService;
          const page = yield* history.logPage({ cwd: repo, offset: 0 });

          assert.isTrue(page.isRepo);
          assert.isFalse(page.hasMore);
          assert.equal(page.offset, 0);
          assert.deepEqual([...page.tips], [merge, side].toSorted());
          assert.isString(page.fingerprint);
          assert.deepEqual(
            page.commits.map((row) => row.hash).toSorted(),
            [root, side, mainline, merge].toSorted(),
          );
          assert.equal(page.commits[0]?.hash, merge);
          assert.equal(page.commits.at(-1)?.hash, root);
          assert.deepEqual(page.commits[0]?.parents, [mainline, side]);
          assert.equal(page.commits[0]?.subject, "merge feature");
          assert.equal(page.commits[0]?.authorName, "t");
          assert.isAbove(page.commits[0]?.authoredAt ?? 0, 0);
          assert.deepEqual(page.commits.at(-1)?.parents, []);
        }),
      ),
  );

  it.effect("logPage should exclude checkpoint refs and stash commits when snapshotting tips", () =>
    inWorkspace((workspace) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const repo = yield* makeRepo(workspace);
        yield* fs.writeFileString(path.join(repo, "file.txt"), "one\n");
        yield* gitIn(repo, ["add", "file.txt"]);
        const head = yield* commit(repo, "tracked");
        const tree = yield* gitIn(repo, ["rev-parse", "HEAD^{tree}"]);
        const checkpoint = yield* gitIn(repo, [
          ...identity,
          "commit-tree",
          tree,
          "-p",
          head,
          "-m",
          "checkpoint",
        ]);
        yield* gitIn(repo, ["update-ref", "refs/t3/x", checkpoint]);
        yield* fs.writeFileString(path.join(repo, "file.txt"), "two\n");
        yield* gitIn(repo, [...identity, "stash", "push", "-m", "wip"]);
        const stash = yield* gitIn(repo, ["rev-parse", "refs/stash"]);

        const history = yield* GitHistoryService.GitHistoryService;
        const page = yield* history.logPage({ cwd: repo, offset: 0 });

        assert.deepEqual([...page.tips], [head]);
        const hashes = page.commits.map((row) => row.hash);
        assert.deepEqual(hashes, [head]);
        assert.notInclude(hashes, checkpoint);
        assert.notInclude(hashes, stash);
      }),
    ),
  );

  it.effect(
    "logPage should include a linked worktree's detached HEAD when no ref points at it",
    () =>
      inWorkspace((workspace) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const repo = yield* makeRepo(workspace);
          const root = yield* commit(repo, "root");
          yield* commit(repo, "second");
          const worktree = path.join(workspace, "detached");
          yield* gitIn(repo, ["worktree", "add", "--detach", worktree, root]);
          const orphan = yield* commit(worktree, "only in worktree");

          const history = yield* GitHistoryService.GitHistoryService;
          const page = yield* history.logPage({ cwd: repo, offset: 0 });

          assert.include([...page.tips], orphan);
          assert.include(
            page.commits.map((row) => row.hash),
            orphan,
          );
        }),
      ),
  );

  it.effect(
    "logPage should return the old snapshot's rows for later pages when a commit lands between page requests",
    () =>
      inWorkspace((workspace) =>
        Effect.gen(function* () {
          const repo = yield* makeRepo(workspace);
          for (const message of ["one", "two", "three", "four"]) {
            yield* commit(repo, message);
          }
          const history = yield* GitHistoryService.GitHistoryService;

          const first = yield* history.logPage({ cwd: repo, offset: 0, limit: 2 });
          const landed = yield* commit(repo, "five");
          const second = yield* history.logPage({
            cwd: repo,
            tips: first.tips,
            offset: 2,
            limit: 2,
          });
          const oneShot = yield* history.logPage({ cwd: repo, tips: first.tips, offset: 0 });

          assert.isTrue(first.hasMore);
          assert.isFalse(second.hasMore);
          assert.isNull(second.fingerprint);
          assert.equal(second.offset, 2);
          assert.deepEqual([...first.commits, ...second.commits], [...oneShot.commits]);
          assert.notInclude(
            oneShot.commits.map((row) => row.hash),
            landed,
          );
        }),
      ),
  );

  it.effect(
    "logPage should fail with GitHistoryTipsExpiredError when a supplied tip object does not exist",
    () =>
      inWorkspace((workspace) =>
        Effect.gen(function* () {
          const repo = yield* makeRepo(workspace);
          const head = yield* commit(repo, "root");
          const history = yield* GitHistoryService.GitHistoryService;

          const error = yield* history
            .logPage({ cwd: repo, tips: [head, "deadbeef".repeat(5)], offset: 0 })
            .pipe(Effect.flip);

          assert.equal(error._tag, "GitHistoryTipsExpiredError");
        }),
      ),
  );

  it.effect("logPage should return no commits when HEAD is unborn", () =>
    inWorkspace((workspace) =>
      Effect.gen(function* () {
        const repo = yield* makeRepo(workspace);
        const history = yield* GitHistoryService.GitHistoryService;

        const page = yield* history.logPage({ cwd: repo, offset: 0 });

        assert.isTrue(page.isRepo);
        assert.deepEqual(page.tips, []);
        assert.deepEqual(page.commits, []);
        assert.isFalse(page.hasMore);
        assert.isString(page.fingerprint);
      }),
    ),
  );

  it.effect(
    "logPage and commitDetail should parse signed commits when the user config sets log.showSignature",
    () =>
      inWorkspace((workspace) =>
        Effect.gen(function* () {
          const repo = yield* makeRepo(workspace);
          const tree = yield* gitIn(repo, ["hash-object", "-t", "tree", "--stdin"], "");
          // An unverifiable signature is enough: git still prints the verification
          // verdict ("No signature") to stdout ahead of the formatted commit.
          const signed = yield* gitIn(
            repo,
            ["hash-object", "-t", "commit", "-w", "--stdin"],
            [
              `tree ${tree}`,
              "author t <t@t> 1700000000 +0000",
              "committer t <t@t> 1700000000 +0000",
              "gpgsig -----BEGIN SSH SIGNATURE-----",
              " bogus",
              " -----END SSH SIGNATURE-----",
              "",
              "signed",
              "",
            ].join("\n"),
          );
          yield* gitIn(repo, ["update-ref", "refs/heads/main", signed]);
          yield* gitIn(repo, ["config", "gpg.format", "ssh"]);
          yield* gitIn(repo, ["config", "log.showSignature", "true"]);

          const history = yield* GitHistoryService.GitHistoryService;
          const page = yield* history.logPage({ cwd: repo, offset: 0 });
          const detail = yield* history.commitDetail({ cwd: repo, hash: signed });

          assert.deepEqual(
            page.commits.map((entry) => entry.hash),
            [signed],
          );
          assert.equal(detail.hash, signed);
          assert.equal(detail.authorName, "t");
          assert.equal(detail.message, "signed");
        }),
      ),
  );

  it.effect("logPage should report isRepo false when the cwd is not a git repository", () =>
    inWorkspace((workspace) =>
      Effect.gen(function* () {
        const history = yield* GitHistoryService.GitHistoryService;

        const page = yield* history.logPage({ cwd: workspace, offset: 0 });
        const refs = yield* history.refs({ cwd: workspace });

        assert.deepEqual(page, {
          isRepo: false,
          tips: [],
          fingerprint: null,
          offset: 0,
          commits: [],
          hasMore: false,
        });
        assert.isFalse(refs.isRepo);
        assert.isNull(refs.repoRoot);
        assert.deepEqual(refs.head, { branch: null, hash: null });
      }),
    ),
  );

  it.effect("logPage should reject a cwd outside the configured workspace roots", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const outside = yield* fs.makeTempDirectoryScoped({ prefix: "t3-history-outside-" });
      yield* inWorkspace(() =>
        Effect.gen(function* () {
          const history = yield* GitHistoryService.GitHistoryService;

          const error = yield* history.logPage({ cwd: outside, offset: 0 }).pipe(Effect.flip);

          assert.equal(error._tag, "VcsRepositoryDetectionError");
          assert.equal(
            error._tag === "VcsRepositoryDetectionError" ? error.detail : null,
            "Git history cwd must stay within the configured workspace root.",
          );
        }),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "fingerprint should stay equal when nothing changed and differ when a branch moves",
    () =>
      inWorkspace((workspace) =>
        Effect.gen(function* () {
          const repo = yield* makeRepo(workspace);
          yield* commit(repo, "root");
          const history = yield* GitHistoryService.GitHistoryService;

          const first = yield* history.fingerprint({ cwd: repo });
          const again = yield* history.fingerprint({ cwd: repo });
          const page = yield* history.logPage({ cwd: repo, offset: 0 });
          const refs = yield* history.refs({ cwd: repo });
          yield* commit(repo, "moved");
          const moved = yield* history.fingerprint({ cwd: repo });

          assert.isTrue(first.isRepo);
          assert.isString(first.fingerprint);
          assert.equal(again.fingerprint, first.fingerprint);
          assert.equal(page.fingerprint, first.fingerprint);
          assert.equal(refs.fingerprint, first.fingerprint);
          assert.notEqual(moved.fingerprint, first.fingerprint);
        }),
      ),
  );

  it.effect(
    "refs should list branches, remotes grouped by remote, peeled tags, stashes with base hashes and linked worktrees when the repo has a bare remote",
    () =>
      inWorkspace((workspace) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const remote = path.join(workspace, "remote.git");
          yield* fs.makeDirectory(remote);
          yield* gitIn(remote, ["init", "--bare", "-b", "main"]);
          const repo = yield* makeRepo(workspace);
          yield* gitIn(repo, ["remote", "add", "origin", remote]);
          yield* fs.writeFileString(path.join(repo, "file.txt"), "one\n");
          yield* gitIn(repo, ["add", "file.txt"]);
          const root = yield* commit(repo, "root");
          yield* gitIn(repo, ["tag", "v1.2"]);
          yield* gitIn(repo, [...identity, "tag", "-a", "v1.10", "-m", "annotated"]);
          yield* gitIn(repo, ["push", "-u", "origin", "main"]);
          yield* gitIn(repo, ["switch", "-c", "feature"]);
          const feature = yield* commit(repo, "feature work");
          yield* gitIn(repo, ["push", "-u", "origin", "feature"]);
          yield* gitIn(repo, ["switch", "main"]);
          yield* gitIn(repo, [
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
          ]);
          yield* fs.writeFileString(path.join(repo, "file.txt"), "two\n");
          yield* gitIn(repo, [...identity, "stash", "push", "-m", "wip"]);
          const stash = yield* gitIn(repo, ["rev-parse", "refs/stash"]);
          const worktree = path.join(workspace, "wt-one");
          yield* gitIn(repo, ["worktree", "add", "-b", "wt-branch", worktree]);
          const tree = yield* gitIn(repo, ["rev-parse", "HEAD^{tree}"]);
          yield* gitIn(repo, [...identity, "tag", "-a", "tree-tag", "-m", "tree", tree]);
          // A worktree whose directory is gone is prunable; its orphan HEAD must vanish.
          const pruned = path.join(workspace, "wt-gone");
          yield* gitIn(repo, ["worktree", "add", "--detach", pruned, root]);
          const prunedHead = yield* commit(pruned, "only in a deleted worktree");
          yield* fs.remove(pruned, { recursive: true });

          const history = yield* GitHistoryService.GitHistoryService;
          const refs = yield* history.refs({ cwd: repo });
          const page = yield* history.logPage({ cwd: repo, offset: 0 });

          assert.isTrue(refs.isRepo);
          assert.equal(refs.repoRoot, repo);
          assert.isString(refs.fingerprint);
          assert.deepEqual(refs.head, { branch: "main", hash: root });
          assert.deepEqual(refs.branches, [
            { name: "feature", hash: feature, upstream: "origin/feature" },
            { name: "main", hash: root, upstream: "origin/main" },
            { name: "wt-branch", hash: root, upstream: null },
          ]);
          assert.deepEqual(refs.remotes, [
            {
              remote: "origin",
              defaultBranch: "main",
              branches: [
                { name: "feature", fullName: "origin/feature", hash: feature },
                { name: "main", fullName: "origin/main", hash: root },
              ],
            },
          ]);
          assert.deepEqual(refs.remoteNames, ["origin"]);
          assert.deepEqual(refs.tags, [
            { name: "v1.10", hash: root },
            { name: "v1.2", hash: root },
          ]);
          assert.deepEqual(refs.stashes, [
            { index: 0, ref: "stash@{0}", message: "On main: wip", hash: stash, baseHash: root },
          ]);
          assert.deepEqual(refs.worktrees, [
            { path: worktree, name: "wt-one", hash: root, branch: "wt-branch" },
          ]);
          assert.deepEqual([...page.tips], [feature, root].toSorted());
          assert.notInclude(
            page.commits.map((row) => row.hash),
            prunedHead,
          );
        }),
      ),
  );

  it.effect("commitDetail should diff a merge commit against its first parent", () =>
    inWorkspace((workspace) =>
      Effect.gen(function* () {
        const repo = yield* makeRepo(workspace);
        yield* writeAndAdd(repo, "base.txt", "base\n");
        yield* commit(repo, "root");
        yield* gitIn(repo, ["switch", "-c", "feature"]);
        yield* writeAndAdd(repo, "side.txt", "side\n");
        const side = yield* commit(repo, "side");
        yield* gitIn(repo, ["switch", "main"]);
        yield* writeAndAdd(repo, "base.txt", "base\nmainline\n");
        const mainline = yield* commit(repo, "mainline");
        yield* gitIn(repo, [...identity, "merge", "--no-ff", "-m", "merge feature", "feature"]);
        const merge = yield* gitIn(repo, ["rev-parse", "HEAD"]);

        const history = yield* GitHistoryService.GitHistoryService;
        const detail = yield* history.commitDetail({ cwd: repo, hash: merge });

        assert.deepEqual(detail.parents, [mainline, side]);
        assert.equal(detail.baseRef, mainline);
        assert.deepEqual(detail.files, [
          { path: "side.txt", previousPath: null, additions: 1, deletions: 0, status: "added" },
        ]);
      }),
    ),
  );

  it.effect("commitDetail should diff a root commit against the empty tree", () =>
    inWorkspace((workspace) =>
      Effect.gen(function* () {
        const repo = yield* makeRepo(workspace);
        yield* writeAndAdd(repo, "first.txt", "one\ntwo\n");
        const root = yield* commit(repo, "root");
        const emptyTree = yield* gitIn(repo, ["hash-object", "-t", "tree", "--stdin"], "");

        const history = yield* GitHistoryService.GitHistoryService;
        const detail = yield* history.commitDetail({ cwd: repo, hash: root });

        assert.deepEqual(detail.parents, []);
        assert.equal(detail.baseRef, emptyTree);
        assert.deepEqual(detail.files, [
          { path: "first.txt", previousPath: null, additions: 2, deletions: 0, status: "added" },
        ]);
      }),
    ),
  );

  it.effect("commitDetail should diff a stash against its base commit", () =>
    inWorkspace((workspace) =>
      Effect.gen(function* () {
        const repo = yield* makeRepo(workspace);
        yield* writeAndAdd(repo, "file.txt", "one\n");
        const base = yield* commit(repo, "base");
        yield* writeFile(repo, "file.txt", "two\n");
        yield* gitIn(repo, [...identity, "stash", "push", "-m", "wip"]);
        const stash = yield* gitIn(repo, ["rev-parse", "refs/stash"]);

        const history = yield* GitHistoryService.GitHistoryService;
        const detail = yield* history.commitDetail({ cwd: repo, hash: stash });

        assert.equal(detail.baseRef, base);
        assert.deepEqual(detail.files, [
          { path: "file.txt", previousPath: null, additions: 1, deletions: 1, status: "modified" },
        ]);
      }),
    ),
  );

  it.effect(
    "commitDetail should return the full message, author and statuses when a file was renamed and another deleted",
    () =>
      inWorkspace((workspace) =>
        Effect.gen(function* () {
          const repo = yield* makeRepo(workspace);
          const body = "line one\nline two\nline three\nline four\n";
          yield* writeAndAdd(repo, "old name.txt", body);
          yield* writeAndAdd(repo, "gone.txt", "bye\n");
          const base = yield* commit(repo, "base");
          yield* gitIn(repo, ["mv", "old name.txt", "new name.txt"]);
          yield* gitIn(repo, ["rm", "-q", "gone.txt"]);
          yield* gitIn(repo, [
            "-c",
            "user.email=author@example.com",
            "-c",
            "user.name=Author Name",
            "commit",
            "-m",
            "Subject line\n\nBody paragraph.\n\n",
          ]);
          const head = yield* gitIn(repo, ["rev-parse", "HEAD"]);

          const history = yield* GitHistoryService.GitHistoryService;
          const detail = yield* history.commitDetail({ cwd: repo, hash: head });

          assert.equal(detail.hash, head);
          assert.deepEqual(detail.parents, [base]);
          assert.equal(detail.message, "Subject line\n\nBody paragraph.");
          assert.equal(detail.authorName, "Author Name");
          assert.equal(detail.authorEmail, "author@example.com");
          assert.equal(detail.committerName, "Author Name");
          assert.isAbove(detail.authoredAt, 0);
          assert.isAbove(detail.committedAt, 0);
          assert.deepEqual(
            detail.files.toSorted((left, right) => left.path.localeCompare(right.path)),
            [
              {
                path: "gone.txt",
                previousPath: null,
                additions: 0,
                deletions: 1,
                status: "deleted",
              },
              {
                path: "new name.txt",
                previousPath: "old name.txt",
                additions: 0,
                deletions: 0,
                status: "renamed",
              },
            ],
          );

          const renameDiff = yield* history.commitFileDiff({
            cwd: repo,
            baseRef: detail.baseRef,
            headRef: head,
            path: "new name.txt",
            previousPath: "old name.txt",
          });
          assert.include(renameDiff.diff, "rename from old name.txt");
          assert.include(renameDiff.diff, "rename to new name.txt");
          assert.notInclude(renameDiff.diff, "new file mode");
        }),
      ),
  );

  it.effect("commitDetail should fail with ref_not_found when the hash is unknown", () =>
    inWorkspace((workspace) =>
      Effect.gen(function* () {
        const repo = yield* makeRepo(workspace);
        yield* commit(repo, "root");

        const history = yield* GitHistoryService.GitHistoryService;
        const error = yield* history
          .commitDetail({ cwd: repo, hash: "1234567890123456789012345678901234567890" })
          .pipe(Effect.flip);

        assert.equal(error._tag, "GitCommandError");
        assert.equal(error._tag === "GitCommandError" ? error.reason : null, "ref_not_found");
      }),
    ),
  );

  it.effect("commitDetail should fail when the hash names a tree instead of a commit", () =>
    inWorkspace((workspace) =>
      Effect.gen(function* () {
        const repo = yield* makeRepo(workspace);
        yield* writeAndAdd(repo, "file.txt", "one\n");
        yield* commit(repo, "root");
        const tree = yield* gitIn(repo, ["rev-parse", "HEAD^{tree}"]);

        const history = yield* GitHistoryService.GitHistoryService;
        const error = yield* history.commitDetail({ cwd: repo, hash: tree }).pipe(Effect.flip);

        assert.equal(error._tag, "GitCommandError");
      }),
    ),
  );

  it.effect("commitFileDiff should mark the diff truncated when the patch exceeds 1 MB", () =>
    inWorkspace((workspace) =>
      Effect.gen(function* () {
        const repo = yield* makeRepo(workspace);
        yield* writeAndAdd(repo, "small.txt", "small\n");
        yield* writeAndAdd(repo, "big.txt", "x".repeat(99).concat("\n").repeat(12_000));
        const head = yield* commit(repo, "root");

        const history = yield* GitHistoryService.GitHistoryService;
        const detail = yield* history.commitDetail({ cwd: repo, hash: head });
        const big = yield* history.commitFileDiff({
          cwd: repo,
          baseRef: detail.baseRef,
          headRef: head,
          path: "big.txt",
          previousPath: null,
        });
        const small = yield* history.commitFileDiff({
          cwd: repo,
          baseRef: detail.baseRef,
          headRef: head,
          path: "small.txt",
          previousPath: null,
        });

        assert.isTrue(big.truncated);
        assert.isAtMost(new TextEncoder().encode(big.diff).byteLength, 1024 * 1024);
        assert.notInclude(big.diff, "small.txt");
        const crypto = yield* Crypto.Crypto;
        const expectedHash = Hex.encode(
          yield* crypto.digest("SHA-256", new TextEncoder().encode(big.diff)),
        );
        assert.equal(big.diffHash, expectedHash);
        assert.isFalse(small.truncated);
        assert.include(small.diff, "+++ b/small.txt");
        assert.notInclude(small.diff, "big.txt");
      }),
    ),
  );
});
