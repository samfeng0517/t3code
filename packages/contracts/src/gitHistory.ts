import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError, GitObjectHash } from "./git.ts";
import { ReviewDiffFileStat } from "./review.ts";
import { VcsRepositoryDetectionError } from "./vcs.ts";

export const GIT_HISTORY_PAGE_SIZE = 500;

export const GitHistoryLogInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** The snapshot tips from the first page; omit to take a fresh snapshot. */
  tips: Schema.optional(Schema.Array(GitObjectHash)),
  offset: NonNegativeInt,
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(GIT_HISTORY_PAGE_SIZE))),
});
export type GitHistoryLogInput = typeof GitHistoryLogInput.Type;

export const GitLogCommit = Schema.Struct({
  hash: GitObjectHash,
  parents: Schema.Array(GitObjectHash),
  authorName: Schema.String,
  /** Unix seconds. */
  authoredAt: NonNegativeInt,
  subject: Schema.String,
});
export type GitLogCommit = typeof GitLogCommit.Type;

export const GitHistoryLogResult = Schema.Struct({
  isRepo: Schema.Boolean,
  tips: Schema.Array(GitObjectHash),
  fingerprint: Schema.NullOr(Schema.String),
  offset: NonNegativeInt,
  commits: Schema.Array(GitLogCommit),
  hasMore: Schema.Boolean,
});
export type GitHistoryLogResult = typeof GitHistoryLogResult.Type;

export const GitHistoryFingerprintInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type GitHistoryFingerprintInput = typeof GitHistoryFingerprintInput.Type;

export const GitHistoryFingerprintResult = Schema.Struct({
  isRepo: Schema.Boolean,
  fingerprint: Schema.NullOr(Schema.String),
});
export type GitHistoryFingerprintResult = typeof GitHistoryFingerprintResult.Type;

export const GitHistoryRefsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type GitHistoryRefsInput = typeof GitHistoryRefsInput.Type;

export const GitHistoryBranch = Schema.Struct({
  name: Schema.String,
  hash: GitObjectHash,
  upstream: Schema.NullOr(Schema.String),
});
export type GitHistoryBranch = typeof GitHistoryBranch.Type;

export const GitHistoryRemoteBranch = Schema.Struct({
  name: Schema.String,
  fullName: Schema.String,
  hash: GitObjectHash,
});
export type GitHistoryRemoteBranch = typeof GitHistoryRemoteBranch.Type;

export const GitHistoryRemote = Schema.Struct({
  remote: Schema.String,
  /** The branch `refs/remotes/<remote>/HEAD` points at, when known. */
  defaultBranch: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  branches: Schema.Array(GitHistoryRemoteBranch),
});
export type GitHistoryRemote = typeof GitHistoryRemote.Type;

export const GitHistoryTag = Schema.Struct({
  name: Schema.String,
  hash: GitObjectHash,
});
export type GitHistoryTag = typeof GitHistoryTag.Type;

export const GitHistoryStash = Schema.Struct({
  index: NonNegativeInt,
  ref: Schema.String,
  message: Schema.String,
  hash: GitObjectHash,
  baseHash: GitObjectHash,
});
export type GitHistoryStash = typeof GitHistoryStash.Type;

export const GitHistoryWorktree = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  hash: Schema.NullOr(GitObjectHash),
  branch: Schema.NullOr(Schema.String),
});
export type GitHistoryWorktree = typeof GitHistoryWorktree.Type;

export const GitHistoryRefsResult = Schema.Struct({
  isRepo: Schema.Boolean,
  repoRoot: Schema.NullOr(Schema.String),
  fingerprint: Schema.NullOr(Schema.String),
  head: Schema.Struct({
    branch: Schema.NullOr(Schema.String),
    hash: Schema.NullOr(GitObjectHash),
  }),
  branches: Schema.Array(GitHistoryBranch),
  remotes: Schema.Array(GitHistoryRemote),
  remoteNames: Schema.Array(Schema.String),
  tags: Schema.Array(GitHistoryTag),
  stashes: Schema.Array(GitHistoryStash),
  worktrees: Schema.Array(GitHistoryWorktree),
});
export type GitHistoryRefsResult = typeof GitHistoryRefsResult.Type;

export const GitCommitDetailInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  hash: GitObjectHash,
});
export type GitCommitDetailInput = typeof GitCommitDetailInput.Type;

export const GitCommitFileStat = Schema.Struct({
  ...ReviewDiffFileStat.fields,
  status: Schema.Literals(["added", "modified", "deleted", "renamed"]),
});
export type GitCommitFileStat = typeof GitCommitFileStat.Type;

export const GitCommitDetailResult = Schema.Struct({
  hash: GitObjectHash,
  parents: Schema.Array(GitObjectHash),
  authorName: Schema.String,
  authorEmail: Schema.String,
  /** Unix seconds. */
  authoredAt: NonNegativeInt,
  committerName: Schema.String,
  /** Unix seconds. */
  committedAt: NonNegativeInt,
  message: Schema.String,
  /** The first parent, or the empty tree for a root commit. */
  baseRef: GitObjectHash,
  files: Schema.Array(GitCommitFileStat),
});
export type GitCommitDetailResult = typeof GitCommitDetailResult.Type;

export const GitCommitFileDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: GitObjectHash,
  headRef: GitObjectHash,
  path: Schema.NonEmptyString,
  previousPath: Schema.NullOr(Schema.NonEmptyString),
});
export type GitCommitFileDiffInput = typeof GitCommitFileDiffInput.Type;

export const GitCommitFileDiffResult = Schema.Struct({
  diff: Schema.String,
  truncated: Schema.Boolean,
  diffHash: Schema.String,
});
export type GitCommitFileDiffResult = typeof GitCommitFileDiffResult.Type;

export class GitHistoryTipsExpiredError extends Schema.TaggedError<GitHistoryTipsExpiredError>()(
  "GitHistoryTipsExpiredError",
  {
    cwd: Schema.String,
  },
) {
  override get message(): string {
    return "The history snapshot is no longer available.";
  }
}

export const GitHistoryError = Schema.Union([
  GitCommandError,
  VcsRepositoryDetectionError,
  GitHistoryTipsExpiredError,
]);
export type GitHistoryError = typeof GitHistoryError.Type;
