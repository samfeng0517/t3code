import type { PullRequestComment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isPullRequestVerdictStale,
  latestPullRequestReviewOutcomes,
  newestPullRequestCommitAt,
  pullRequestApprovalCount,
  pullRequestApprovers,
} from "./pullRequestReviews.ts";

const COMMENT: PullRequestComment = {
  id: "c1",
  kind: "issue-comment",
  author: { login: "bilal", name: null, avatarUrl: null },
  body: "looks good",
  createdAt: "2026-07-03T00:00:00Z",
  url: null,
  path: null,
  reviewState: null,
};

const review = (
  id: string,
  login: string,
  reviewState: string,
  createdAt: string,
): PullRequestComment => ({
  id,
  kind: "review",
  author: { login, name: null, avatarUrl: null },
  body: "",
  createdAt,
  url: null,
  path: null,
  reviewState,
});

describe("review verdicts", () => {
  it("keeps each reviewer's last word, whatever order the host returned them in", () => {
    expect(
      latestPullRequestReviewOutcomes([
        review("r3", "bilal", "APPROVED", "2026-07-03T00:00:00Z"),
        review("r1", "bilal", "CHANGES_REQUESTED", "2026-07-01T00:00:00Z"),
        review("r2", "octocat", "CHANGES_REQUESTED", "2026-07-02T00:00:00Z"),
        review("r4", "octocat", "COMMENTED", "2026-07-04T00:00:00Z"),
      ]).map((entry) => [entry.actor?.login, entry.outcome]),
    ).toEqual([
      ["bilal", "approved"],
      ["octocat", "changes-requested"],
    ]);
  });

  it("calls a verdict stale once commits land after it, and current before that", () => {
    const commits = [
      { oid: "c0ffee", messageHeadline: "later work", committedDate: "2026-07-05T00:00:00Z" },
    ];
    const approval = (createdAt: string): PullRequestComment => ({
      ...COMMENT,
      kind: "review",
      reviewState: "APPROVED",
      createdAt,
    });

    expect(
      latestPullRequestReviewOutcomes([approval("2026-07-01T00:00:00Z")], commits)[0]?.stale,
    ).toBe(true);
    expect(
      latestPullRequestReviewOutcomes([approval("2026-07-06T00:00:00Z")], commits)[0]?.stale,
    ).toBe(false);
    expect(latestPullRequestReviewOutcomes([approval("2026-07-01T00:00:00Z")], [])[0]?.stale).toBe(
      false,
    );
  });

  it("orders instants rather than their text, so a UTC offset cannot invert them", () => {
    expect(
      newestPullRequestCommitAt([
        { oid: "a", messageHeadline: "", committedDate: "2026-07-05T00:30:00Z" },
        { oid: "b", messageHeadline: "", committedDate: "2026-07-05T01:00:00+02:00" },
      ]),
    ).toBe("2026-07-05T00:30:00Z");
    expect(isPullRequestVerdictStale("2026-07-05T00:30:00Z", "2026-07-05T01:00:00+02:00")).toBe(
      false,
    );
    expect(isPullRequestVerdictStale("2026-07-01T00:00:00Z", "not a date")).toBe(false);
    expect(
      newestPullRequestCommitAt([{ oid: "a", messageHeadline: "", committedDate: "not a date" }]),
    ).toBeNull();
  });

  it("shows nothing for a reviewer whose verdict was dismissed", () => {
    expect(
      latestPullRequestReviewOutcomes([
        {
          ...COMMENT,
          kind: "review",
          reviewState: "APPROVED",
          createdAt: "2026-07-01T00:00:00Z",
        },
        {
          ...COMMENT,
          id: "c2",
          kind: "review",
          reviewState: "DISMISSED",
          createdAt: "2026-07-02T00:00:00Z",
        },
      ]),
    ).toEqual([]);
  });
});

describe("pullRequestApprovers", () => {
  const octocat = { login: "octocat", name: null, avatarUrl: null };

  it("pullRequestApprovers should return host approvers with fromHost when approvedBy is present even if reviews show none", () => {
    expect(
      pullRequestApprovers({
        approvedBy: [octocat, { login: "OctoCat", name: "dup", avatarUrl: null }],
        comments: [],
        commits: [],
      }),
    ).toEqual({ approvers: [{ key: "octocat", actor: octocat }], fromHost: true });
  });

  it("pullRequestApprovers should return an empty host list when approvedBy is empty and reviews approve", () => {
    expect(
      pullRequestApprovers({
        approvedBy: [],
        comments: [review("r1", "bilal", "APPROVED", "2026-07-03T00:00:00Z")],
        commits: [],
      }),
    ).toEqual({ approvers: [], fromHost: true });
  });

  it("pullRequestApprovers should derive non-stale approvals when approvedBy is absent", () => {
    expect(
      pullRequestApprovers({
        comments: [
          review("r1", "bilal", "APPROVED", "2026-07-01T00:00:00Z"),
          review("r2", "octocat", "APPROVED", "2026-07-06T00:00:00Z"),
          review("r3", "hubot", "CHANGES_REQUESTED", "2026-07-06T00:00:00Z"),
        ],
        commits: [{ oid: "a", messageHeadline: "", committedDate: "2026-07-05T00:00:00Z" }],
      }),
    ).toEqual({ approvers: [{ key: "octocat", actor: octocat }], fromHost: false });
  });

  it("pullRequestApprovalCount should count host approvers when comments are truncated and ignore truncated review history", () => {
    const base = { comments: [], commits: [], commentsTruncated: true };
    expect(pullRequestApprovalCount({ ...base, approvedBy: [octocat] })).toBe(1);
    expect(
      pullRequestApprovalCount({
        ...base,
        comments: [review("r1", "octocat", "APPROVED", "2026-07-06T00:00:00Z")],
      }),
    ).toBe(0);
  });
});
