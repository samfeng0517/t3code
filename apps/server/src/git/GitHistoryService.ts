import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  GIT_HISTORY_PAGE_SIZE,
  GitHistoryTipsExpiredError,
  VcsRepositoryDetectionError,
  type GitCommitDetailInput,
  type GitCommitDetailResult,
  type GitCommitFileDiffInput,
  type GitCommitFileDiffResult,
  type GitCommitFileStat,
  type GitHistoryError,
  type GitHistoryFingerprintInput,
  type GitHistoryFingerprintResult,
  type GitHistoryLogInput,
  type GitHistoryLogResult,
  type GitHistoryRefsInput,
  type GitHistoryRefsResult,
  type GitLogCommit,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { parseReviewNumstat, REVIEW_DIFF_ARGS } from "../vcs/GitVcsDriverCore.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import { assertWorkspaceBoundCwd } from "../workspace/workspaceBoundary.ts";
import {
  parseRemoteNames,
  parseRemoteNamesInGitOrder,
  parseRemoteRefWithRemoteNames,
} from "./remoteRefs.ts";

const BOUNDARY_DETAIL = "Git history cwd must stay within the configured workspace root.";
const LARGE_OUTPUT_MAX_BYTES = 16 * 1024 * 1024;
const FILE_DIFF_MAX_BYTES = 1024 * 1024;
const SUBJECT_MAX_LENGTH = 300;
const NULL_HASH = /^0+$/;
const tagNameCollator = new Intl.Collator("en", { numeric: true });

export class GitHistoryService extends Context.Service<
  GitHistoryService,
  {
    readonly logPage: (
      input: GitHistoryLogInput,
    ) => Effect.Effect<GitHistoryLogResult, GitHistoryError>;
    readonly fingerprint: (
      input: GitHistoryFingerprintInput,
    ) => Effect.Effect<GitHistoryFingerprintResult, GitHistoryError>;
    readonly refs: (
      input: GitHistoryRefsInput,
    ) => Effect.Effect<GitHistoryRefsResult, GitHistoryError>;
    readonly commitDetail: (
      input: GitCommitDetailInput,
    ) => Effect.Effect<GitCommitDetailResult, GitHistoryError>;
    readonly commitFileDiff: (
      input: GitCommitFileDiffInput,
    ) => Effect.Effect<GitCommitFileDiffResult, GitHistoryError>;
  }
>()("t3/git/GitHistoryService") {}

interface RefRow {
  readonly objectName: string;
  readonly peeledName: string;
  readonly objectType: string;
  readonly peeledType: string;
  readonly refName: string;
}

interface WorktreeRecord {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly prunable: boolean;
}

interface HistorySnapshot {
  readonly rows: ReadonlyArray<RefRow>;
  readonly head: { readonly branch: string | null; readonly hash: string | null };
  /** Every record `git worktree list` printed, main worktree first. */
  readonly worktrees: ReadonlyArray<WorktreeRecord>;
  readonly tips: ReadonlyArray<string>;
  readonly fingerprint: string;
}

function parseRefRows(stdout: string): ReadonlyArray<RefRow> {
  return stdout.split("\n").flatMap((line) => {
    const [objectName, peeledName, objectType, refName, peeledType] = line.split("\0");
    if (!objectName || !objectType || !refName) return [];
    return [
      {
        objectName,
        peeledName: peeledName ?? "",
        objectType,
        peeledType: peeledType ?? "",
        refName,
      },
    ];
  });
}

function parseWorktreeRecords(stdout: string): ReadonlyArray<WorktreeRecord> {
  const records: WorktreeRecord[] = [];
  let current: {
    path: string;
    head: string | null;
    branch: string | null;
    prunable: boolean;
  } | null = null;
  const flush = () => {
    if (current !== null) records.push(current);
    current = null;
  };
  for (const field of stdout.split("\0")) {
    if (field === "") {
      flush();
    } else if (field.startsWith("worktree ")) {
      flush();
      current = {
        path: field.slice("worktree ".length),
        head: null,
        branch: null,
        prunable: false,
      };
    } else if (current === null) {
      continue;
    } else if (field.startsWith("HEAD ")) {
      const head = field.slice("HEAD ".length);
      // An unborn worktree reports the all-zero object name.
      current.head = NULL_HASH.test(head) ? null : head;
    } else if (field.startsWith("branch refs/heads/")) {
      current.branch = field.slice("branch refs/heads/".length);
    } else if (field === "prunable" || field.startsWith("prunable ")) {
      current.prunable = true;
    }
  }
  flush();
  return records;
}

/** The commit a graph tip ref names, or null when it is not one the graph draws. */
function graphTipCommit(row: RefRow): string | null {
  if (row.refName.startsWith("refs/heads/")) {
    return row.objectType === "commit" ? row.objectName : null;
  }
  if (row.refName.startsWith("refs/remotes/")) {
    return row.objectType === "commit" && !row.refName.endsWith("/HEAD") ? row.objectName : null;
  }
  if (row.refName.startsWith("refs/tags/")) {
    return tagCommit(row);
  }
  return null;
}

function tagCommit(row: RefRow): string | null {
  if (row.objectType === "commit") return row.objectName;
  if (row.objectType === "tag" && row.peeledType === "commit") return row.peeledName;
  return null;
}

function truncateSubject(subject: string): string {
  if (subject.length <= SUBJECT_MAX_LENGTH) return subject;
  return [...subject].slice(0, SUBJECT_MAX_LENGTH).join("");
}

function parseLogRows(stdout: string): GitLogCommit[] {
  return stdout.split("\x1e").flatMap((chunk) => {
    const record = chunk.replace(/^\n/, "");
    if (record.length === 0) return [];
    const [hash, parents, authorName, authoredAt, subject] = record.split("\0");
    if (!hash) return [];
    return [
      {
        hash,
        parents: parents ? parents.split(" ") : [],
        authorName: authorName ?? "",
        authoredAt: Math.max(0, Number(authoredAt) || 0),
        subject: truncateSubject(subject ?? ""),
      },
    ];
  });
}

/** Maps each path in `diff --name-status -z` output to its change status. */
function parseNameStatus(stdout: string): Map<string, GitCommitFileStat["status"]> {
  const statuses = new Map<string, GitCommitFileStat["status"]>();
  const fields = stdout.split("\0");
  for (let index = 0; index < fields.length; index++) {
    const code = fields[index]!;
    if (code === "") continue;
    if (code.startsWith("R") || code.startsWith("C")) {
      index += 2;
      const path = fields[index];
      if (path !== undefined) statuses.set(path, "renamed");
      continue;
    }
    const path = fields[++index];
    if (path === undefined) continue;
    statuses.set(path, code === "A" ? "added" : code === "D" ? "deleted" : "modified");
  }
  return statuses;
}

/** @public */
export const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const crypto = yield* Crypto.Crypto;
  const path = yield* Path.Path;
  const workspaceContext = yield* Effect.context<
    ServerConfig.ServerConfig | FileSystem.FileSystem | Path.Path | KnownWorkspaces.KnownWorkspaces
  >();

  const run = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options: Pick<
      GitVcsDriver.ExecuteGitInput,
      "stdin" | "allowNonZeroExit" | "maxOutputBytes"
    > = {},
  ) => git.execute({ operation, cwd, args, ...options });

  /** The repo root every git run uses, or null when `cwd` is not in a git repository. */
  const resolveRepoRoot = Effect.fn("GitHistoryService.resolveRepoRoot")(function* (
    operation: string,
    cwd: string,
  ) {
    yield* assertWorkspaceBoundCwd(operation, cwd, BOUNDARY_DETAIL).pipe(
      Effect.provide(workspaceContext),
    );
    const handle = yield* registry.detect({ cwd }).pipe(
      Effect.mapError((cause) =>
        cause._tag === "VcsRepositoryDetectionError"
          ? cause
          : new VcsRepositoryDetectionError({
              operation,
              cwd,
              detail: "Failed to detect a VCS repository for Git history.",
              cause,
            }),
      ),
    );
    if (handle?.kind !== "git") return null;
    const result = yield* run(`${operation}.repoRoot`, cwd, ["rev-parse", "--show-toplevel"]);
    return result.stdout.trim();
  });

  // SHA-256 over in-memory bytes has no real failure mode; a failure is a defect.
  const sha256Hex = (text: string) =>
    crypto
      .digest("SHA-256", new TextEncoder().encode(text))
      .pipe(Effect.map(Hex.encode), Effect.orDie);

  const hashFingerprint = (lines: ReadonlyArray<string>) => sha256Hex(lines.toSorted().join("\n"));

  /** Like `resolveRepoRoot`, for reads that have no meaning outside a git repository. */
  const requireRepoRoot = Effect.fn("GitHistoryService.requireRepoRoot")(function* (
    operation: string,
    cwd: string,
  ) {
    const repoRoot = yield* resolveRepoRoot(operation, cwd);
    if (repoRoot === null) {
      return yield* new VcsRepositoryDetectionError({
        operation,
        cwd,
        detail: "Git history requires a git repository.",
      });
    }
    return repoRoot;
  });

  /** `worktree list --porcelain -z`, retrying without `-z` for git before 2.36. */
  const listWorktrees = Effect.fn("GitHistoryService.listWorktrees")(function* (repoRoot: string) {
    const args = ["worktree", "list", "--porcelain"];
    const options = { maxOutputBytes: LARGE_OUTPUT_MAX_BYTES };
    const result = yield* run("GitHistoryService.snapshot.worktrees", repoRoot, [...args, "-z"], {
      ...options,
      allowNonZeroExit: true,
    });
    if (result.exitCode === 0) return result.stdout;
    const lineResult = yield* run("GitHistoryService.snapshot.worktrees", repoRoot, args, options);
    return lineResult.stdout.replaceAll("\n", "\0");
  });

  const snapshot = Effect.fn("GitHistoryService.snapshot")(function* (repoRoot: string) {
    const [refsResult, headResult, branchResult, worktreeStdout] = yield* Effect.all(
      [
        run(
          "GitHistoryService.snapshot.refs",
          repoRoot,
          [
            "for-each-ref",
            // `*objecttype` (beyond the four core fields) tells an annotated tag on a
            // commit from one on a tree or blob, which the graph must skip.
            "--format=%(objectname)%00%(*objectname)%00%(objecttype)%00%(refname)%00%(*objecttype)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
            "refs/stash",
          ],
          { maxOutputBytes: LARGE_OUTPUT_MAX_BYTES },
        ),
        run(
          "GitHistoryService.snapshot.head",
          repoRoot,
          ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
          { allowNonZeroExit: true },
        ),
        run(
          "GitHistoryService.snapshot.branch",
          repoRoot,
          ["symbolic-ref", "--quiet", "--short", "HEAD"],
          { allowNonZeroExit: true },
        ),
        listWorktrees(repoRoot),
      ],
      { concurrency: "unbounded" },
    );

    const rows = parseRefRows(refsResult.stdout);
    const head = {
      branch: branchResult.exitCode === 0 ? branchResult.stdout.trim() || null : null,
      hash: headResult.exitCode === 0 ? headResult.stdout.trim() || null : null,
    };
    const worktrees = parseWorktreeRecords(worktreeStdout);
    const liveWorktrees = worktrees.filter((worktree) => !worktree.prunable);

    const tips = new Set<string>();
    for (const row of rows) {
      const commit = graphTipCommit(row);
      if (commit !== null) tips.add(commit);
    }
    if (head.hash !== null) tips.add(head.hash);
    for (const worktree of liveWorktrees) {
      if (worktree.head !== null) tips.add(worktree.head);
    }

    const fingerprint = yield* hashFingerprint([
      ...rows.map((row) => `${row.refName} ${row.objectName}`),
      `HEAD ${head.branch ?? head.hash ?? "unborn"}`,
      ...liveWorktrees.map(
        (worktree) =>
          `worktree ${worktree.path} ${worktree.head ?? "none"} ${worktree.branch ?? "detached"}`,
      ),
    ]);

    return {
      rows,
      head,
      worktrees,
      tips: [...tips].toSorted(),
      fingerprint,
    } satisfies HistorySnapshot;
  });

  const assertTipsExist = Effect.fn("GitHistoryService.assertTipsExist")(function* (
    cwd: string,
    repoRoot: string,
    tips: ReadonlyArray<string>,
  ) {
    const result = yield* run(
      "GitHistoryService.logPage.checkTips",
      repoRoot,
      ["cat-file", "--batch-check"],
      { stdin: `${tips.join("\n")}\n` },
    );
    if (result.stdout.split("\n").some((line) => line.endsWith(" missing"))) {
      return yield* new GitHistoryTipsExpiredError({ cwd });
    }
  });

  const logPage: GitHistoryService["Service"]["logPage"] = Effect.fn("GitHistoryService.logPage")(
    function* (input) {
      const repoRoot = yield* resolveRepoRoot("GitHistoryService.logPage", input.cwd);
      if (repoRoot === null) {
        return {
          isRepo: false,
          tips: [],
          fingerprint: null,
          offset: input.offset,
          commits: [],
          hasMore: false,
        };
      }

      let tips: ReadonlyArray<string>;
      let fingerprint: string | null = null;
      if (input.tips === undefined) {
        const current = yield* snapshot(repoRoot);
        tips = current.tips;
        fingerprint = current.fingerprint;
      } else {
        tips = input.tips;
        if (tips.length > 0) yield* assertTipsExist(input.cwd, repoRoot, tips);
      }

      if (tips.length === 0) {
        return {
          isRepo: true,
          tips,
          fingerprint,
          offset: input.offset,
          commits: [],
          hasMore: false,
        };
      }

      const limit = input.limit ?? GIT_HISTORY_PAGE_SIZE;
      const result = yield* run(
        "GitHistoryService.logPage.log",
        repoRoot,
        // Output flags stay explicit: user config such as log.showSignature or
        // color.ui would otherwise print extra text into the parsed stdout.
        [
          "log",
          "--topo-order",
          "--no-color",
          "--no-show-signature",
          "--format=%H%x00%P%x00%an%x00%at%x00%s%x1e",
          `--skip=${input.offset}`,
          `--max-count=${limit + 1}`,
          "--stdin",
        ],
        // Git cannot cap one placeholder's length, so a run of very long subjects
        // could outgrow the default cap; subjects are truncated after parsing.
        { stdin: `${tips.join("\n")}\n`, maxOutputBytes: LARGE_OUTPUT_MAX_BYTES },
      );
      const rows = parseLogRows(result.stdout);
      return {
        isRepo: true,
        tips,
        fingerprint,
        offset: input.offset,
        commits: rows.slice(0, limit),
        hasMore: rows.length > limit,
      };
    },
  );

  const fingerprint: GitHistoryService["Service"]["fingerprint"] = Effect.fn(
    "GitHistoryService.fingerprint",
  )(function* (input) {
    const repoRoot = yield* resolveRepoRoot("GitHistoryService.fingerprint", input.cwd);
    if (repoRoot === null) return { isRepo: false, fingerprint: null };
    const current = yield* snapshot(repoRoot);
    return { isRepo: true, fingerprint: current.fingerprint };
  });

  const refs: GitHistoryService["Service"]["refs"] = Effect.fn("GitHistoryService.refs")(
    function* (input) {
      const repoRoot = yield* resolveRepoRoot("GitHistoryService.refs", input.cwd);
      if (repoRoot === null) {
        return {
          isRepo: false,
          repoRoot: null,
          fingerprint: null,
          head: { branch: null, hash: null },
          branches: [],
          remotes: [],
          remoteNames: [],
          tags: [],
          stashes: [],
          worktrees: [],
        };
      }

      const [current, upstreamResult, remoteResult, stashResult] = yield* Effect.all(
        [
          snapshot(repoRoot),
          run(
            "GitHistoryService.refs.upstreams",
            repoRoot,
            ["for-each-ref", "--format=%(refname)%00%(upstream:short)", "refs/heads"],
            { maxOutputBytes: LARGE_OUTPUT_MAX_BYTES },
          ),
          run("GitHistoryService.refs.remotes", repoRoot, ["remote"]),
          run(
            "GitHistoryService.refs.stashes",
            repoRoot,
            ["stash", "list", "--no-show-signature", "--format=%H%x00%P%x00%gd%x00%gs"],
            { maxOutputBytes: LARGE_OUTPUT_MAX_BYTES },
          ),
        ],
        { concurrency: "unbounded" },
      );

      const upstreams = new Map<string, string>();
      for (const line of upstreamResult.stdout.split("\n")) {
        const [refName, upstream] = line.split("\0");
        if (refName && upstream) upstreams.set(refName, upstream);
      }

      const remoteNames = parseRemoteNamesInGitOrder(remoteResult.stdout);
      const remoteNamesLongestFirst = parseRemoteNames(remoteResult.stdout);
      const remotes = new Map<
        string,
        Array<{ readonly name: string; readonly fullName: string; readonly hash: string }>
      >();
      const branches: Array<GitHistoryRefsResult["branches"][number]> = [];
      const tags: Array<GitHistoryRefsResult["tags"][number]> = [];

      for (const row of current.rows) {
        if (row.refName.startsWith("refs/heads/")) {
          if (row.objectType !== "commit") continue;
          branches.push({
            name: row.refName.slice("refs/heads/".length),
            hash: row.objectName,
            upstream: upstreams.get(row.refName) ?? null,
          });
        } else if (row.refName.startsWith("refs/remotes/")) {
          if (row.objectType !== "commit") continue;
          const fullName = row.refName.slice("refs/remotes/".length);
          const parsed = parseRemoteRefWithRemoteNames(fullName, remoteNamesLongestFirst);
          const separator = fullName.indexOf("/");
          const remote = parsed?.remoteName ?? fullName.slice(0, separator);
          const name = parsed?.branchName ?? fullName.slice(separator + 1);
          if (separator < 0 || name === "HEAD") continue;
          const group = remotes.get(remote) ?? [];
          group.push({ name, fullName, hash: row.objectName });
          remotes.set(remote, group);
        } else if (row.refName.startsWith("refs/tags/")) {
          const hash = tagCommit(row);
          if (hash === null) continue;
          tags.push({ name: row.refName.slice("refs/tags/".length), hash });
        }
      }

      const stashes = stashResult.stdout.split("\n").flatMap((line) => {
        const [hash, parents, ref, message] = line.split("\0");
        const index = /^stash@\{(\d+)\}$/.exec(ref ?? "")?.[1];
        const baseHash = parents?.split(" ")[0];
        if (!hash || !ref || index === undefined || !baseHash) return [];
        return [{ index: Number(index), ref, message: message ?? "", hash, baseHash }];
      });

      return {
        isRepo: true,
        repoRoot,
        fingerprint: current.fingerprint,
        head: current.head,
        branches,
        remotes: [...remotes].map(([remote, remoteBranches]) => ({
          remote,
          branches: remoteBranches,
        })),
        remoteNames,
        tags: tags.toSorted((left, right) => tagNameCollator.compare(right.name, left.name)),
        stashes,
        // The first record is the main worktree; prunable ones have lost their directory.
        worktrees: current.worktrees
          .slice(1)
          .filter((worktree) => !worktree.prunable)
          .map((worktree) => ({
            path: worktree.path,
            name: path.basename(worktree.path),
            hash: worktree.head,
            branch: worktree.branch,
          })),
      };
    },
  );

  const commitDetail: GitHistoryService["Service"]["commitDetail"] = Effect.fn(
    "GitHistoryService.commitDetail",
  )(function* (input) {
    const repoRoot = yield* requireRepoRoot("GitHistoryService.commitDetail", input.cwd);
    // `show` on a tag, tree or blob prints that object instead of failing, so
    // resolve to a commit first; anything else is rejected here.
    const commitHash = (yield* run("GitHistoryService.commitDetail.verify", repoRoot, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${input.hash}^{commit}`,
    ])).stdout.trim();
    const show = yield* run(
      "GitHistoryService.commitDetail.show",
      repoRoot,
      [
        "show",
        "-s",
        "--no-color",
        "--no-show-signature",
        "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ct%x00%B",
        "--end-of-options",
        commitHash,
      ],
      { maxOutputBytes: LARGE_OUTPUT_MAX_BYTES },
    );
    const [hash, parentList, authorName, authorEmail, authoredAt, committerName, committedAt] =
      show.stdout.split("\0", 7);
    // `%B` comes last, so a NUL inside the message only ever splits the message.
    const message = show.stdout.split("\0").slice(7).join("\0").trimEnd();
    const parents = parentList ? parentList.split(" ") : [];

    // The first parent is also the base of a merge (what it brought in) and of a
    // stash (the commit it was made on); a root commit diffs against the empty tree,
    // hashed here so SHA-256 repositories get their own empty tree name.
    const baseRef =
      parents[0] ??
      (yield* run(
        "GitHistoryService.commitDetail.emptyTree",
        repoRoot,
        ["hash-object", "-t", "tree", "--stdin"],
        { stdin: "" },
      )).stdout.trim();

    const [numstat, nameStatus] = yield* Effect.all(
      [
        run(
          "GitHistoryService.commitDetail.numstat",
          repoRoot,
          [...REVIEW_DIFF_ARGS, "--numstat", "-z", baseRef, commitHash],
          { maxOutputBytes: LARGE_OUTPUT_MAX_BYTES },
        ),
        run(
          "GitHistoryService.commitDetail.nameStatus",
          repoRoot,
          [...REVIEW_DIFF_ARGS, "--name-status", "-z", baseRef, commitHash],
          { maxOutputBytes: LARGE_OUTPUT_MAX_BYTES },
        ),
      ],
      { concurrency: "unbounded" },
    );
    const statuses = parseNameStatus(nameStatus.stdout);

    return {
      hash: hash ?? commitHash,
      parents,
      authorName: authorName ?? "",
      authorEmail: authorEmail ?? "",
      authoredAt: Math.max(0, Number(authoredAt) || 0),
      committerName: committerName ?? "",
      committedAt: Math.max(0, Number(committedAt) || 0),
      message,
      baseRef,
      files: parseReviewNumstat(numstat.stdout).map((file) => ({
        ...file,
        status: statuses.get(file.path) ?? "modified",
      })),
    };
  });

  const commitFileDiff: GitHistoryService["Service"]["commitFileDiff"] = Effect.fn(
    "GitHistoryService.commitFileDiff",
  )(function* (input) {
    const repoRoot = yield* requireRepoRoot("GitHistoryService.commitFileDiff", input.cwd);
    const pathspecs = [input.path, ...(input.previousPath === null ? [] : [input.previousPath])];
    const result = yield* git.execute({
      operation: "GitHistoryService.commitFileDiff.patch",
      cwd: repoRoot,
      args: [
        ...REVIEW_DIFF_ARGS,
        "--patch",
        input.baseRef,
        input.headRef,
        "--",
        ...pathspecs.map((pathspec) => `:(top,literal)${pathspec}`),
      ],
      maxOutputBytes: FILE_DIFF_MAX_BYTES,
      appendTruncationMarker: true,
    });
    const diffHash = yield* sha256Hex(result.stdout);
    return { diff: result.stdout, truncated: result.stdoutTruncated, diffHash };
  });

  return GitHistoryService.of({ logPage, fingerprint, refs, commitDetail, commitFileDiff });
});

export const layer = Layer.effect(GitHistoryService, make);
