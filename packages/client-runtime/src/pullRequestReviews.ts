import type { PullRequestActor, PullRequestComment, PullRequestCommit } from "@t3tools/contracts";

export type PullRequestReviewOutcome = "approved" | "changes-requested" | "dismissed";

/** Normalize host verdict formats; ignore non-verdict review states. */
export function pullRequestReviewOutcome(
  reviewState: string | null,
): PullRequestReviewOutcome | null {
  switch (reviewState?.trim().toLowerCase().replaceAll("_", "-")) {
    case "approved":
      return "approved";
    case "changes-requested":
      return "changes-requested";
    case "dismissed":
      return "dismissed";
    default:
      return null;
  }
}

// Host UTC offsets make lexical timestamp sorting unsafe.
function instant(iso: string): number {
  return Date.parse(iso);
}

export function newestPullRequestCommitAt(
  commits: ReadonlyArray<PullRequestCommit>,
): string | null {
  let newest: string | null = null;
  let newestAt = Number.NEGATIVE_INFINITY;
  for (const commit of commits) {
    const at = instant(commit.committedDate);
    if (Number.isNaN(at) || at <= newestAt) continue;
    newest = commit.committedDate;
    newestAt = at;
  }
  return newest;
}

export function isPullRequestVerdictStale(at: string, newestCommitAt: string | null): boolean {
  if (newestCommitAt === null) return false;
  const verdictAt = instant(at);
  const commitAt = instant(newestCommitAt);
  return !Number.isNaN(verdictAt) && !Number.isNaN(commitAt) && verdictAt < commitAt;
}

export interface PullRequestReviewOutcomeEntry {
  readonly key: string;
  readonly actor: PullRequestActor | null;
  readonly outcome: PullRequestReviewOutcome;
  readonly at: string;
  readonly stale: boolean;
}

export function latestPullRequestReviewOutcomes(
  comments: ReadonlyArray<PullRequestComment>,
  commits: ReadonlyArray<PullRequestCommit> = [],
): ReadonlyArray<PullRequestReviewOutcomeEntry> {
  const newestCommitAt = newestPullRequestCommitAt(commits);
  const latest = new Map<string, PullRequestReviewOutcomeEntry>();
  for (const comment of comments) {
    const outcome = pullRequestReviewOutcome(comment.reviewState);
    if (outcome === null) continue;
    const login = comment.author?.login ?? `ghost:${comment.id}`;
    const current = latest.get(login);
    // Hosts can return reviews out of order.
    if (current !== undefined && instant(current.at) > instant(comment.createdAt)) continue;
    latest.set(login, {
      key: login,
      actor: comment.author,
      outcome,
      at: comment.createdAt,
      stale: isPullRequestVerdictStale(comment.createdAt, newestCommitAt),
    });
  }
  return [...latest.values()].filter((entry) => entry.outcome !== "dismissed");
}

export interface PullRequestApprover {
  readonly key: string;
  readonly actor: PullRequestActor | null;
}

/** Host-reported approvers win; review history is the fallback for hosts that report none. */
export function pullRequestApprovers(input: {
  readonly approvedBy?: ReadonlyArray<PullRequestActor> | undefined;
  readonly comments: ReadonlyArray<PullRequestComment>;
  readonly commits: ReadonlyArray<PullRequestCommit>;
}): { readonly approvers: ReadonlyArray<PullRequestApprover>; readonly fromHost: boolean } {
  if (input.approvedBy !== undefined) {
    const seen = new Set<string>();
    const approvers: PullRequestApprover[] = [];
    for (const actor of input.approvedBy) {
      const login = actor.login.toLowerCase();
      if (seen.has(login)) continue;
      seen.add(login);
      approvers.push({ key: actor.login, actor });
    }
    return { approvers, fromHost: true };
  }
  return {
    approvers: latestPullRequestReviewOutcomes(input.comments, input.commits)
      .filter((entry) => entry.outcome === "approved" && !entry.stale)
      .map((entry) => ({ key: entry.key, actor: entry.actor })),
    fromHost: false,
  };
}

/** Truncated comments make derived approvals unreliable, so only host-reported approvers count then. */
export function pullRequestApprovalCount(
  detail:
    | (Parameters<typeof pullRequestApprovers>[0] & { readonly commentsTruncated: boolean })
    | null,
): number {
  if (detail === null) return 0;
  const { approvers, fromHost } = pullRequestApprovers(detail);
  return fromHost || !detail.commentsTruncated ? approvers.length : 0;
}
