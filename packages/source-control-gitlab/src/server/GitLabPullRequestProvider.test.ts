import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";

import * as GitLabCli from "./GitLabCli.ts";
import * as GitLabPullRequestCli from "./GitLabPullRequestCli.ts";
import { gitLabViewerPermissions, make } from "./GitLabPullRequestProvider.ts";
import type { GitLabBranch, GitLabMergeRequestDetail } from "./gitLabMergeRequestJson.ts";

it.effect.each(["merge", "disable-auto-merge"] as const)(
  "keeps reads and %s on the selected host when glab prefers another remote",
  (action) =>
    Effect.gen(function* () {
      const selectedHost = "gitlab.example.test:8443";
      const otherHost = "other.gitlab.example.test";
      const readHosts: string[] = [];
      const mergedHosts: string[] = [];
      const native = yield* GitLabCli.make.pipe(
        Effect.provide(
          TestSourceControlHost.layer({
            process: {
              run: (input) => {
                // glab prefers a remote named `gitlab` to `origin`. The checkout's
                // selected repository must still own every request and mutation.
                const host = input.env?.GITLAB_HOST ?? otherHost;
                const path = input.args[1];
                const mutation =
                  input.args[0] === "mr" || (input.args.includes("POST") && path !== "graphql");
                if (mutation) mergedHosts.push(host);
                else readHosts.push(host);
                const response = mutation
                  ? {}
                  : path === "graphql"
                    ? {
                        data: {
                          project: {
                            mergeRequests: {
                              nodes: [
                                { iid: "7", diffStatsSummary: { additions: 2, deletions: 1 } },
                              ],
                            },
                            mergeRequest: {
                              diffStatsSummary: { fileCount: 1 },
                              diffStats: [{ path: "src/a.ts", additions: 2, deletions: 1 }],
                            },
                          },
                        },
                      }
                    : path?.includes("merge_requests/")
                      ? {
                          iid: 7,
                          title: "Merge request 7",
                          web_url: `https://${host}/acme/web/-/merge_requests/7`,
                          source_branch: "feature",
                          target_branch: "main",
                          created_at: "2026-07-01T00:00:00Z",
                          updated_at: "2026-07-02T00:00:00Z",
                          user: { can_merge: true },
                          diff_refs: {
                            head_sha: "a".repeat(40),
                            base_sha: "b".repeat(40),
                            start_sha: "b".repeat(40),
                          },
                        }
                      : path === "user"
                        ? { username: "reviewer" }
                        : path?.includes("/labels?") || path?.includes("/users?")
                          ? []
                          : { merge_method: "merge", squash_option: "default_off" };
                return Effect.succeed(
                  TestSourceControlHost.processOutput(JSON.stringify(response)),
                );
              },
            },
          }),
        ),
      );
      const cli = yield* GitLabPullRequestCli.make.pipe(
        Effect.provideService(GitLabCli.GitLabCli, native),
      );
      const provider = yield* make.pipe(
        Effect.provideService(GitLabPullRequestCli.GitLabPullRequestCli, cli),
      );
      const reference = {
        cwd: "/repo",
        repository: "acme/web",
        host: selectedHost,
        number: 7,
      };
      const detail = yield* provider.getChangeRequest(reference);
      expect({ additions: detail.additions, deletions: detail.deletions }).toEqual({
        additions: 2,
        deletions: 1,
      });
      assert.isDefined(provider.getChangeRequestSummary);
      expect((yield* provider.getChangeRequestSummary(reference)).additions).toBe(2);
      assert.isDefined(provider.listChangeRequestStats);
      expect(
        yield* provider.listChangeRequestStats({ ...reference, changeRequests: [reference] }),
      ).toEqual([{ repository: reference.repository, number: 7, additions: 2, deletions: 1 }]);
      assert.isDefined(provider.getFileStats);
      expect(yield* provider.getFileStats(reference)).toEqual({
        files: [{ path: "src/a.ts", additions: 2, deletions: 1 }],
        truncated: false,
      });
      expect(yield* provider.getViewer(reference)).toBe("reviewer");
      assert.isDefined(provider.listRepositoryLabels);
      yield* provider.listRepositoryLabels(reference);
      assert.isDefined(provider.searchRepositoryAuthors);
      yield* provider.searchRepositoryAuthors(reference);
      yield* provider.runAction({ ...reference, action });

      // The merge request read also asks for its approvals.
      expect(readHosts).toEqual(Array(action === "merge" ? 12 : 11).fill(selectedHost));
      expect({ url: detail.url, mutatedHosts: mergedHosts }).toEqual({
        url: `https://${selectedHost}/acme/web/-/merge_requests/7`,
        mutatedHosts: [selectedHost],
      });
    }),
);

describe("gitLabViewerPermissions", () => {
  it("offers everything to a viewer GitLab says can merge", () => {
    expect(gitLabViewerPermissions({ viewerCanMerge: true, canDeleteBranch: true })).toEqual({
      actions: [
        "merge",
        "ready",
        "draft",
        "close",
        "reopen",
        "delete-branch",
        "update-branch",
        "enable-auto-merge",
        "disable-auto-merge",
      ],
      comment: true,
      resolve: true,
      verdicts: ["comment", "approve"],
      requestReviewers: true,
      labels: true,
      updateMethods: ["rebase"],
    });
  });

  it("keeps merge, now and later, from a viewer GitLab says cannot", () => {
    expect(gitLabViewerPermissions({ viewerCanMerge: false })).toEqual({
      actions: ["ready", "draft", "close", "reopen"],
      comment: true,
      resolve: true,
      verdicts: ["comment", "approve"],
      requestReviewers: true,
      labels: true,
    });
  });

  it("trades approving for taking the approval back once the viewer has approved", () => {
    const permissions = gitLabViewerPermissions({
      viewerCanMerge: true,
      approvals: { approvedBy: [], approvalsLeft: 0, viewerHasApproved: true },
    });
    expect(permissions.actions).toContain("unapprove");
    expect(permissions.verdicts).toEqual(["comment"]);
  });

  it("offers no approval to a viewer GitLab says cannot approve", () => {
    const permissions = gitLabViewerPermissions({
      viewerCanMerge: true,
      approvals: {
        approvedBy: [],
        approvalsLeft: 1,
        viewerHasApproved: false,
        viewerCanApprove: false,
      },
    });
    expect(permissions.actions).not.toContain("unapprove");
    expect(permissions.verdicts).toEqual(["comment"]);
  });
});

describe("getChangeRequest base freshness", () => {
  const detail = {
    number: 7,
    title: "Merge request 7",
    url: "https://gitlab.com/acme/web/-/merge_requests/7",
    author: null,
    headBranch: "feat/page",
    baseBranch: "main",
    state: "open" as const,
    isDraft: false,
    mergeability: "mergeable" as const,
    additions: 0,
    deletions: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
    reviewRequestLogins: [],
    labels: [],
    body: "",
    changedFiles: 1,
    mergedAt: null,
    closedAt: null,
    reviewers: [],
    checks: [],
    viewerCanMerge: true,
    reviewerIds: [],
  };

  it.effect.each(["getChangeRequestPreview", "getChangeRequestSummary"] as const)(
    "%s preserves merge request fields without fetching project settings",
    (operation) =>
      Effect.gen(function* () {
        const provider = yield* make.pipe(
          Effect.provide(
            Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({
              getMergeRequestDetail: () => Effect.succeed(detail),
              listMergeRequestStats: () => Effect.succeed([]),
            }),
          ),
        );
        const read = provider[operation];
        assert.isDefined(read);
        expect(
          yield* read({ cwd: "/w", repository: "acme/web", host: "gitlab.com", number: 7 }),
        ).toEqual(detail);
      }),
  );

  const readWith = (
    divergence: { readonly divergedCommits?: number },
    stats: GitLabPullRequestCli.GitLabPullRequestCli["Service"]["listMergeRequestStats"] = () =>
      Effect.succeed([]),
  ) =>
    Effect.gen(function* () {
      const provider = yield* make;
      return yield* provider.getChangeRequest({
        cwd: "/w",
        repository: "acme/web",
        host: "gitlab.com",
        number: 7,
      });
    }).pipe(
      Effect.provide(
        Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({
          getMergeRequestDetail: () => Effect.succeed({ ...detail, ...divergence }),
          getProjectMergeCapabilities: () =>
            Effect.succeed({ merge: true, squash: true, rebase: true }),
          getApprovals: () => Effect.succeed({ approvedBy: [], approvalsLeft: null }),
          listMergeRequestStats: stats,
        }),
      ),
    );

  it.effect("reads a counted divergence as a branch that has fallen behind", () =>
    Effect.gen(function* () {
      const changeRequest = yield* readWith({ divergedCommits: 3 });

      expect(changeRequest.baseComparison).toBe("behind");
      expect(changeRequest.behindBy).toBe(3);
    }),
  );

  it.effect("says nothing at all where GitLab counted nothing", () =>
    Effect.gen(function* () {
      const changeRequest = yield* readWith({});

      expect(changeRequest.baseComparison).toBe("unknown");
      expect(changeRequest.behindBy).toBeUndefined();
    }),
  );

  it.effect("fills in the line counts the REST detail leaves out", () =>
    Effect.gen(function* () {
      const changeRequest = yield* readWith({}, () =>
        Effect.succeed([{ repository: "acme/web", number: 7, additions: 40, deletions: 2 }]),
      );

      expect(changeRequest.additions).toBe(40);
      expect(changeRequest.deletions).toBe(2);
    }),
  );

  it.effect("reports an unauthenticated line count read instead of a detail without counts", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        readWith({}, () =>
          Effect.fail(
            new GitLabCli.GitLabCliAuthenticationError({
              operation: "execute",
              command: "glab",
              cwd: "/w",
              cause: null,
            }),
          ),
        ),
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "PullRequestProviderError", reason: "unauthenticated" },
      });
    }),
  );

  it.effect("gives linked threads line counts without reading the merge settings", () =>
    Effect.gen(function* () {
      const summary = yield* Effect.gen(function* () {
        const provider = yield* make;
        const read = provider.getChangeRequestSummary;
        if (read === undefined) return yield* Effect.die("summary read missing");
        return yield* read({ cwd: "/w", repository: "acme/web", host: "gitlab.com", number: 7 });
      }).pipe(
        Effect.provide(
          Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({
            getMergeRequestDetail: () => Effect.succeed(detail),
            getProjectMergeCapabilities: () => Effect.die("linked threads skip merge settings"),
            listMergeRequestStats: () =>
              Effect.succeed([{ repository: "acme/web", number: 7, additions: 40, deletions: 2 }]),
          }),
        ),
      );

      expect(summary.additions).toBe(40);
      expect(summary.deletions).toBe(2);
    }),
  );
});

describe("merge request reads", () => {
  const reference = { cwd: "/w", repository: "acme/web", host: "gitlab.com", number: 7 };
  const detail = {
    number: 7,
    title: "Merge request 7",
    url: "https://gitlab.com/acme/web/-/merge_requests/7",
    author: null,
    headBranch: "feat/page",
    baseBranch: "main",
    state: "open" as const,
    isDraft: false,
    mergeability: "mergeable" as const,
    additions: 0,
    deletions: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
    reviewRequestLogins: [],
    labels: [],
    body: "",
    changedFiles: 1,
    mergedAt: null,
    closedAt: null,
    reviewers: [],
    checks: [],
    viewerCanMerge: true,
    reviewerIds: [],
  };

  const countingProvider = Effect.gen(function* () {
    const calls = { detail: 0, mergeCapabilities: 0 };
    const host = { viewerCanMerge: true };
    const provider = yield* make.pipe(
      Effect.provide(
        Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({
          listMergeRequestStats: () => Effect.succeed([]),
          getMergeRequestDetail: (input) =>
            Effect.sync(() => {
              calls.detail += 1;
              return { ...detail, number: input.number, viewerCanMerge: host.viewerCanMerge };
            }),
          getProjectMergeCapabilities: () =>
            Effect.sync(() => {
              calls.mergeCapabilities += 1;
              return { merge: true, squash: true, rebase: true };
            }),
          getApprovals: () => Effect.succeed({ approvedBy: [], approvalsLeft: null }),
          runMergeRequestAction: () => Effect.void,
        }),
      ),
    );
    const checks = provider.getChangeRequestChecks;
    const forget = provider.forgetChangeRequestReads;
    if (checks === undefined || forget === undefined) {
      return yield* Effect.die("GitLab answers checks and forgets its reads");
    }
    return { provider, checks, forget, calls, host };
  });

  it.effect("asks for a project's merge methods once across its merge requests", () =>
    Effect.gen(function* () {
      const { provider, calls } = yield* countingProvider;

      yield* provider.getChangeRequest(reference);
      yield* provider.getChangeRequest(reference);
      yield* provider.getChangeRequest({ ...reference, number: 8 });

      expect(calls.mergeCapabilities).toBe(1);
    }),
  );

  it.effect("answers checks from the merge request the detail just read", () =>
    Effect.gen(function* () {
      const { provider, checks, calls } = yield* countingProvider;

      yield* provider.getChangeRequest(reference);
      yield* checks(reference);

      expect(calls.detail).toBe(1);

      const summary = provider.getChangeRequestSummary;
      assert.isDefined(summary);
      yield* summary(reference);
      expect(calls.detail).toBe(2);
    }),
  );

  it.effect("reads a merge request again after a write to it", () =>
    Effect.gen(function* () {
      const { provider, checks, calls } = yield* countingProvider;

      yield* provider.getChangeRequest(reference);
      yield* provider.runAction({ ...reference, action: "ready" });
      yield* checks(reference);

      expect(calls.detail).toBe(2);
    }),
  );

  it.effect.each([{ cwd: "/other" }, { host: "other.gitlab.test" }])(
    "does not share reads with %j",
    (other) =>
      Effect.gen(function* () {
        const { provider, calls } = yield* countingProvider;

        yield* provider.getChangeRequest(reference);
        yield* provider.getChangeRequest({ ...reference, ...other });
        yield* provider.getChangeRequest(reference);
        yield* provider.getChangeRequest({ ...reference, ...other });

        expect(calls).toEqual({ detail: 2, mergeCapabilities: 2 });
      }),
  );

  it.effect("reads a merge request again once a minute has passed", () =>
    Effect.gen(function* () {
      const { provider, calls } = yield* countingProvider;

      yield* provider.getChangeRequest(reference);
      yield* TestClock.adjust("61 seconds");
      yield* provider.getChangeRequest(reference);

      expect(calls.detail).toBe(2);
    }),
  );

  it.effect("answers viewer permissions from the host, not the page's read", () =>
    Effect.gen(function* () {
      const { provider, host } = yield* countingProvider;

      host.viewerCanMerge = false;
      yield* provider.getChangeRequest(reference);
      host.viewerCanMerge = true;
      const granted = yield* provider.getViewerPermissions(reference);
      host.viewerCanMerge = false;
      const revoked = yield* provider.getViewerPermissions(reference);

      expect(granted.actions).toContain("merge");
      expect(revoked.actions).not.toContain("merge");
    }),
  );

  it.effect("reads a merge request again once its reads are forgotten", () =>
    Effect.gen(function* () {
      const { provider, checks, forget, calls } = yield* countingProvider;
      const other = { ...reference, repository: "acme/api" };

      yield* provider.getChangeRequest(reference);
      yield* provider.getChangeRequest(other);
      yield* forget({ repository: "ACME/web", number: 7 });
      yield* checks(reference);
      yield* checks(other);
      expect(calls.detail).toBe(3);

      yield* forget({ repository: "acme/web" });
      yield* checks(reference);
      yield* forget();
      yield* checks(other);
      expect(calls.detail).toBe(5);
    }),
  );
});

describe("optional activity reads", () => {
  const reference = { cwd: "/w", repository: "acme/web", host: "gitlab.com", number: 7 };
  const comment = {
    id: "42",
    kind: "issue-comment" as const,
    author: null,
    body: "Keep this comment",
    createdAt: "2026-07-01T00:00:00Z",
    url: null,
    path: null,
    reviewState: null,
  };
  const commit = {
    oid: "abc",
    messageHeadline: "Keep this commit",
    committedDate: "2026-07-01T00:00:00Z",
  };
  const reads = {
    listNotes: () => Effect.succeed({ comments: [comment], truncated: false }),
    listCommits: () => Effect.succeed([commit]),
    listDiscussions: () => Effect.succeed({ threads: [], truncated: false }),
    listReactions: () => Effect.succeed({ reactions: [], reactionsByNoteId: new Map() }),
  };
  const context = {
    operation: "execute" as const,
    command: "glab" as const,
    cwd: "/w",
    cause: null,
  };

  it.effect.each([
    {
      operation: "listNotes",
      error: new GitLabCli.GitLabCliAuthenticationError(context),
      reason: "unauthenticated",
    },
    {
      operation: "listCommits",
      error: new GitLabCli.GitLabCliUnavailableError(context),
      reason: "missing-tool",
    },
  ] as const)(
    "reports $reason instead of successful partial activity",
    ({ operation, error, reason }) =>
      Effect.gen(function* () {
        const provider = yield* make.pipe(
          Effect.provide(
            Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({
              ...reads,
              [operation]: () => Effect.fail(error),
            }),
          ),
        );

        expect(yield* Effect.result(provider.getChangeRequestActivity(reference))).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "PullRequestProviderError",
            provider: "gitlab",
            operation: "getChangeRequestActivity",
            reason,
            detail: error.detail,
            cause: error,
          },
        });
      }),
  );

  it.effect("keeps comments and commits when optional discussions and reactions fail", () =>
    Effect.gen(function* () {
      const provider = yield* make.pipe(
        Effect.provide(
          Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({
            ...reads,
            listDiscussions: () =>
              Effect.fail(
                new GitLabPullRequestCli.GitLabMergeRequestReadError({
                  command: "glab",
                  cwd: "/w",
                  operation: "listDiscussions",
                  cause: null,
                }),
              ),
            listReactions: () => Effect.fail(new GitLabCli.GitLabCliCommandError(context)),
          }),
        ),
      );

      expect(yield* provider.getChangeRequestActivity(reference)).toEqual({
        comments: [{ ...comment, reactions: [] }],
        commentCount: 1,
        commentsTruncated: true,
        reviewThreads: [],
        reactions: [],
        commits: [commit],
      });
    }),
  );
});

describe("getChangeRequest approvals and pipeline", () => {
  const reference = {
    cwd: "/w",
    repository: "sam/t3code",
    host: "gitlab.example.com",
    number: 7,
  };
  const detail = {
    number: 7,
    title: "Merge request 7",
    url: "https://gitlab.example.com/sam/t3code/-/merge_requests/7",
    author: null,
    headBranch: "feat/page",
    baseBranch: "main",
    state: "open" as const,
    isDraft: false,
    mergeability: "mergeable" as const,
    additions: 0,
    deletions: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
    reviewRequestLogins: [],
    labels: [],
    body: "",
    changedFiles: 1,
    mergedAt: null,
    closedAt: null,
    reviewers: [],
    checks: [{ name: "Pipeline", status: "failure" as const, description: "push", url: null }],
    viewerCanMerge: true,
    reviewerIds: [],
    headPipeline: { id: 99, projectId: 12 },
  };
  const approver = { login: "octocat", name: null, avatarUrl: null };
  const jobs = [
    { name: "test", status: "success" as const, description: "test", url: null },
    { name: "lint", status: "failure" as const, description: "test", url: null },
  ];

  const readWith = (cli: Partial<GitLabPullRequestCli.GitLabPullRequestCli["Service"]>) =>
    Effect.gen(function* () {
      const provider = yield* make;
      return yield* provider.getChangeRequest(reference);
    }).pipe(
      Effect.provide(
        Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({
          getMergeRequestDetail: () => Effect.succeed(detail),
          getProjectMergeCapabilities: () =>
            Effect.succeed({ merge: true, squash: true, rebase: false }),
          getApprovals: () =>
            Effect.succeed({
              approvedBy: [approver],
              approvalsLeft: 0,
              viewerHasApproved: true,
              viewerCanApprove: false,
            }),
          listPipelineJobs: () => Effect.succeed({ checks: jobs, truncated: false }),
          listPipelineBridges: () => Effect.succeed({ checks: [], truncated: false }),
          listMergeRequestStats: () => Effect.succeed([]),
          ...cli,
        }),
      ),
    );

  it.effect("reads the head pipeline's jobs, in the pipeline's own project, as its checks", () =>
    Effect.gen(function* () {
      const asked: Array<{ readonly project: string | number; readonly host?: string }> = [];
      const changeRequest = yield* readWith({
        listPipelineJobs: (input) =>
          Effect.sync(() => {
            asked.push({ project: input.project, ...(input.host ? { host: input.host } : {}) });
            return { checks: jobs, truncated: false };
          }),
      });

      expect(changeRequest.checks).toEqual(jobs);
      expect(asked).toEqual([{ project: 12, host: "gitlab.example.com" }]);
    }),
  );

  it.effect("keeps a failed pipeline failing when every job it lists passed", () =>
    Effect.gen(function* () {
      const passed = jobs.map((job) => ({ ...job, status: "success" as const }));
      const changeRequest = yield* readWith({
        listPipelineJobs: () => Effect.succeed({ checks: passed, truncated: false }),
      });

      expect(changeRequest.checks).toEqual([...passed, ...detail.checks]);
    }),
  );

  it.effect("reads a failed trigger job as the check that fails the pipeline", () =>
    Effect.gen(function* () {
      const passed = jobs.map((job) => ({ ...job, status: "success" as const }));
      const bridge = { name: "deploy", status: "failure" as const, description: null, url: null };
      const changeRequest = yield* readWith({
        listPipelineJobs: () => Effect.succeed({ checks: passed, truncated: false }),
        listPipelineBridges: () => Effect.succeed({ checks: [bridge], truncated: false }),
      });

      expect(changeRequest.checks).toEqual([...passed, bridge]);
    }),
  );

  it.effect("reads changes requested over an approval count GitLab calls enough", () =>
    Effect.gen(function* () {
      const changeRequest = yield* readWith({
        getMergeRequestDetail: () =>
          Effect.succeed({ ...detail, reviewDecision: "changes-requested" as const }),
      });

      expect(changeRequest.reviewDecision).toBe("changes-requested");
    }),
  );

  it.effect("keeps the pipeline as one check when its jobs cannot be read", () =>
    Effect.gen(function* () {
      const changeRequest = yield* readWith({
        listPipelineJobs: () =>
          Effect.fail(
            new GitLabCli.GitLabCliCommandError({
              operation: "execute",
              command: "glab",
              cwd: "/w",
              cause: null,
            }),
          ),
      });

      expect(changeRequest.checks).toEqual(detail.checks);
    }),
  );

  it.effect("reads an approval the viewer gave as approved, and offers to take it back", () =>
    Effect.gen(function* () {
      const changeRequest = yield* readWith({});

      expect(changeRequest.reviewDecision).toBe("approved");
      expect(changeRequest.viewerPermissions.actions).toContain("unapprove");
      expect(changeRequest.viewerPermissions.verdicts).toEqual(["comment"]);
    }),
  );

  it.effect("still reads the merge request where GitLab withholds its approvals", () =>
    Effect.gen(function* () {
      const changeRequest = yield* readWith({
        getApprovals: () =>
          Effect.fail(
            new GitLabCli.GitLabCliCommandError({
              operation: "execute",
              command: "glab",
              cwd: "/w",
              cause: null,
            }),
          ),
      });

      expect(changeRequest.reviewDecision).toBeNull();
      expect(changeRequest.viewerPermissions.actions).not.toContain("unapprove");
      expect(changeRequest.viewerPermissions.verdicts).toEqual(["comment", "approve"]);
    }),
  );

  it.effect("fails the read when approvals say the account is signed out", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        readWith({
          getApprovals: () =>
            Effect.fail(
              new GitLabCli.GitLabCliAuthenticationError({
                operation: "execute",
                command: "glab",
                cwd: "/w",
                cause: null,
              }),
            ),
        }),
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "PullRequestProviderError", reason: "unauthenticated" },
      });
    }),
  );
});

describe("deleting an ended merge request's source branch", () => {
  const reference = {
    cwd: "/w",
    repository: "sam/t3code",
    host: "gitlab.example.com",
    number: 7,
  };
  const merged: GitLabMergeRequestDetail = {
    number: 7,
    title: "Merge request 7",
    url: "https://gitlab.example.com/sam/t3code/-/merge_requests/7",
    author: null,
    headBranch: "feat/page",
    baseBranch: "main",
    state: "merged",
    isDraft: false,
    mergeability: "unknown",
    additions: 0,
    deletions: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
    reviewRequestLogins: [],
    labels: [],
    body: "",
    changedFiles: 1,
    mergedAt: "2026-07-02T00:00:00Z",
    closedAt: null,
    reviewers: [],
    checks: [],
    viewerCanMerge: true,
    reviewerIds: [],
    headSha: "head-sha",
    sourceProjectId: 42,
  };

  const permissionsWith = (input: {
    readonly detail?: Partial<GitLabMergeRequestDetail>;
    readonly branch: GitLabBranch | null;
    readonly asked?: Array<{ readonly project: string | number; readonly branch: string }>;
  }) =>
    Effect.gen(function* () {
      const provider = yield* make;
      return yield* provider.getViewerPermissions(reference);
    }).pipe(
      Effect.provide(
        Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({
          getMergeRequestDetail: () => Effect.succeed({ ...merged, ...input.detail }),
          getApprovals: () => Effect.succeed({ approvedBy: [], approvalsLeft: null }),
          getBranch: (branch) =>
            Effect.sync(() => {
              input.asked?.push({ project: branch.project, branch: branch.branch });
              return input.branch;
            }),
        }),
      ),
    );

  it.effect("is not offered once the branch is already gone", () =>
    Effect.gen(function* () {
      const asked: Array<{ readonly project: string | number; readonly branch: string }> = [];
      const permissions = yield* permissionsWith({ branch: null, asked });

      expect(permissions.actions).not.toContain("delete-branch");
      expect(asked).toEqual([{ project: 42, branch: "feat/page" }]);
    }),
  );

  it.effect("is offered while the branch sits where it ended, to a reader who can push", () =>
    Effect.gen(function* () {
      const permissions = yield* permissionsWith({
        branch: { headSha: "head-sha", canPush: true },
      });

      expect(permissions.actions).toContain("delete-branch");
    }),
  );

  it.effect("is not offered to a reader outside the project", () =>
    Effect.gen(function* () {
      const permissions = yield* permissionsWith({
        detail: { viewerCanMerge: false },
        branch: { headSha: "head-sha", canPush: false },
      });

      expect(permissions.actions).not.toContain("delete-branch");
    }),
  );

  it.effect("is not offered once new commits moved the branch", () =>
    Effect.gen(function* () {
      const permissions = yield* permissionsWith({
        branch: { headSha: "later-sha", canPush: true },
      });

      expect(permissions.actions).not.toContain("delete-branch");
    }),
  );

  it.effect("costs no branch read while the merge request is open", () =>
    Effect.gen(function* () {
      const asked: Array<{ readonly project: string | number; readonly branch: string }> = [];
      const permissions = yield* permissionsWith({
        detail: { state: "open" },
        branch: { headSha: "head-sha", canPush: true },
        asked,
      });

      expect(permissions.actions).not.toContain("delete-branch");
      expect(asked).toEqual([]);
    }),
  );
});
