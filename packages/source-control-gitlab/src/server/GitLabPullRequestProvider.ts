import { SourceControlProviderKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type {
  PullRequestCapabilities,
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestReaction,
  PullRequestViewerPermissions,
} from "@t3tools/contracts";

import * as GitLabPullRequestCli from "./GitLabPullRequestCli.ts";
import {
  gitLabApprovalDecision,
  type GitLabApprovals,
  type GitLabMergeRequestDetail,
} from "./gitLabMergeRequestJson.ts";
import {
  PullRequestProviderError,
  type PullRequestProviderFailure,
  type ProviderChangeRequestActivity,
  type ProviderChangeRequestDetail,
  type PullRequestProviderApi,
} from "@t3tools/source-control-core/server/PullRequestProvider";
import { definition } from "../shared/definition.ts";

const CAPABILITIES: PullRequestCapabilities = {
  diff: true,
  comment: true,
  actions: [...definition.changeRequestActions],
  mergeMethods: ["merge", "squash", "rebase"],
  deleteBranch: true,
  labels: true,
  // GitLab has no merge-target-into-source operation.
  updateMethods: ["rebase"],
  search: true,
  reactions: true,
  // GitLab's viewed marks live in browser-local storage.
  viewedFiles: "environment",
  review: {
    inlineComment: true,
    reply: true,
    resolve: true,
    // GitLab has no requested-changes verdict.
    verdicts: ["comment", "approve"],
  },
  reviewers: { request: true, listCandidates: true },
  edit: { changeRequest: true, comment: true },
};

const UNAVAILABLE_REQUIREMENT = {
  missing:
    "GitLab CLI (`glab`) is required to browse change requests on this host. Install it from https://gitlab.com/gitlab-org/cli and reload.",
  unauthenticated: "GitLab CLI is not authenticated. Run `glab auth login` and retry.",
};

/**
 * The actions `user.can_merge` answers for. Rebasing writes to the source branch rather than to
 * the target, so it is not literally the same permission — but GitLab reports nothing narrower,
 * and someone it will not let land this change has no business rewriting its branch either.
 */
const MERGE_ACTIONS: ReadonlySet<string> = new Set([
  "merge",
  "update-branch",
  "enable-auto-merge",
  "disable-auto-merge",
]);

/**
 * Authors may close/reopen/change draft state regardless of role; REST omits authorship.
 * Approval is the exception: only the approver can take one back, so unapprove is offered only
 * after approving, and approving stays on offer where approvals could not be read. Deleting the
 * source branch is offered only where `canDeleteBranch` says it is still there and the reader's.
 */
export function gitLabViewerPermissions(input: {
  readonly viewerCanMerge: boolean;
  readonly approvals?: GitLabApprovals | null | undefined;
  readonly canDeleteBranch?: boolean | undefined;
}): PullRequestViewerPermissions {
  const hasApproved = input.approvals?.viewerHasApproved === true;
  const canApprove = !hasApproved && input.approvals?.viewerCanApprove !== false;
  return {
    actions: CAPABILITIES.actions.filter(
      (action) =>
        (!MERGE_ACTIONS.has(action) || input.viewerCanMerge) &&
        (action !== "unapprove" || hasApproved) &&
        (action !== "delete-branch" || input.canDeleteBranch === true),
    ),
    comment: true,
    resolve: true,
    verdicts: CAPABILITIES.review.verdicts.filter((verdict) => verdict !== "approve" || canApprove),
    requestReviewers: true,
    labels: true,
    ...(input.viewerCanMerge ? { updateMethods: CAPABILITIES.updateMethods } : {}),
  };
}

/** Pipeline outcomes a job list can hide: GitLab leaves trigger jobs out of it. */
const UNSETTLED_PIPELINE_STATUSES: ReadonlySet<PullRequestCheckStatus> = new Set([
  "failure",
  "pending",
  "cancelled",
]);

/**
 * The head pipeline's jobs as its checks, keeping the pipeline's own check wherever it says
 * something none of them does: a failed downstream pipeline fails its parent while every job
 * listed beside it passed.
 */
function gitLabPipelineChecks(
  pipeline: ReadonlyArray<PullRequestCheck>,
  jobs: ReadonlyArray<PullRequestCheck>,
): ReadonlyArray<PullRequestCheck> {
  if (jobs.length === 0) return pipeline;
  const unexplained = pipeline.filter(
    (check) =>
      UNSETTLED_PIPELINE_STATUSES.has(check.status) &&
      !jobs.some((job) => job.status === check.status),
  );
  return [...jobs, ...unexplained];
}

function gitLabProviderFailure(
  error: GitLabPullRequestCli.GitLabPullRequestCliError,
): PullRequestProviderFailure {
  if (error._tag === "GitLabCliUnavailableError") return { reason: "missing-tool" };
  if (error._tag === "GitLabCliAuthenticationError") return { reason: "unauthenticated" };
  if (error._tag === "GitLabCliRateLimitError") return { reason: "rate-limited" };
  if (error._tag === "GitLabMergeRequestNotFoundError") return { reason: "not-found" };
  return { reason: "failed" };
}

export const make = Effect.gen(function* () {
  const cli = yield* GitLabPullRequestCli.GitLabPullRequestCli;

  const fail = (operation: string) => (error: GitLabPullRequestCli.GitLabPullRequestCliError) =>
    new PullRequestProviderError({
      provider: SourceControlProviderKind.make("gitlab"),
      operation,
      ...gitLabProviderFailure(error),
      detail: error.detail,
      cause: error,
    });

  // Optional endpoints may lose part of the activity, but an unusable CLI or account must
  // reach the caller so it can report authentication failures and pause a throttled host.
  const recoverRead = <A>(
    read: Effect.Effect<A, GitLabPullRequestCli.GitLabPullRequestCliError>,
    fallback: A,
  ) =>
    read.pipe(
      Effect.catch((error) => {
        const { reason } = gitLabProviderFailure(error);
        return reason === "rate-limited" ||
          reason === "unauthenticated" ||
          reason === "missing-tool"
          ? Effect.fail(error)
          : Effect.succeed(fallback);
      }),
    );

  // Approvals and jobs fill in a merge request that reads without them, so losing either to a
  // host that withholds them must not lose the merge request.
  const approvalsOf = (input: GitLabPullRequestCli.GitLabTarget) =>
    recoverRead<GitLabApprovals | null>(cli.getApprovals(input), null);

  /** The head pipeline's jobs and trigger jobs, or the pipeline as one check without them. */
  const checksOf = Effect.fn("GitLabPullRequestProvider.checksOf")(function* (
    input: GitLabPullRequestCli.GitLabTarget,
    mergeRequest: GitLabMergeRequestDetail,
  ) {
    const pipeline = mergeRequest.headPipeline;
    if (pipeline === undefined) return mergeRequest.checks;
    const target = {
      cwd: input.cwd,
      host: input.host,
      project: pipeline.projectId ?? input.repository,
      pipelineId: pipeline.id,
    };
    const none: ReadonlyArray<PullRequestCheck> = [];
    const [jobs, bridges] = yield* Effect.all(
      [
        recoverRead(cli.listPipelineJobs(target), { checks: none, truncated: false }),
        recoverRead(cli.listPipelineBridges(target), { checks: none, truncated: false }),
      ],
      { concurrency: 2 },
    );
    return gitLabPipelineChecks(mergeRequest.checks, [...jobs.checks, ...bridges.checks]);
  });

  /**
   * Whether the reader may delete an ended merge request's source branch: only while it still
   * exists at the commit the merge request ended on, as `deleteSourceBranch` will insist, and
   * where GitLab says the reader can push to it. An open merge request keeps its branch, so it
   * costs no request.
   */
  const canDeleteBranchOf = Effect.fn("GitLabPullRequestProvider.canDeleteBranchOf")(function* (
    input: GitLabPullRequestCli.GitLabTarget,
    mergeRequest: GitLabMergeRequestDetail,
  ) {
    if (mergeRequest.state === "open" || mergeRequest.headSha === undefined) return false;
    const branch = yield* recoverRead(
      cli.getBranch({
        cwd: input.cwd,
        host: input.host,
        project: mergeRequest.sourceProjectId ?? input.repository,
        branch: mergeRequest.headBranch,
      }),
      null,
    );
    if (branch === null || branch.headSha !== mergeRequest.headSha) return false;
    // `can_push` answers for the branch's own project, a fork included; an install too old to
    // say falls back to whether the reader may merge at all.
    return branch.canPush ?? mergeRequest.viewerCanMerge;
  });

  const provider: PullRequestProviderApi = {
    kind: SourceControlProviderKind.make("gitlab"),
    capabilities: CAPABILITIES,
    unavailableRequirement: UNAVAILABLE_REQUIREMENT,

    getViewer: (input) =>
      cli
        .getViewerUsername({ cwd: input.cwd, host: input.host })
        .pipe(Effect.mapError(fail("getViewer"))),

    listChangeRequests: (input) =>
      cli
        .listMergeRequests({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          state: input.state,
          involvement: input.involvement,
          viewer: input.viewer,
          limit: input.limit,
          query: input.query,
          cursor: input.cursor,
          filters: input.filters,
        })
        .pipe(
          Effect.mapError(fail("listChangeRequests")),
          Effect.map((batch) => ({ ...batch, continues: true })),
        ),

    getChangeRequestChecks: (input) =>
      cli.getMergeRequestDetail(input).pipe(
        Effect.flatMap((mergeRequest) =>
          checksOf(input, mergeRequest).pipe(
            Effect.map((checks) => ({ state: mergeRequest.state, checks })),
          ),
        ),
        Effect.mapError(fail("getChangeRequestChecks")),
      ),

    // Merge settings only affect the detail panel's actions.
    getChangeRequestPreview: (input) =>
      cli.getMergeRequestDetail(input).pipe(Effect.mapError(fail("getChangeRequestPreview"))),

    getChangeRequestSummary: (input) =>
      cli.getMergeRequestDetail(input).pipe(Effect.mapError(fail("getChangeRequestSummary"))),

    getChangeRequest: (input) =>
      Effect.all(
        [
          cli.getMergeRequestDetail(input),
          cli.getProjectMergeCapabilities({
            cwd: input.cwd,
            host: input.host,
            repository: input.repository,
          }),
          approvalsOf(input),
        ],
        { concurrency: 3 },
      ).pipe(
        Effect.flatMap(([mergeRequest, mergeCapabilities, approvals]) =>
          Effect.all([checksOf(input, mergeRequest), canDeleteBranchOf(input, mergeRequest)], {
            concurrency: 2,
          }).pipe(
            Effect.map(([checks, canDeleteBranch]) => ({
              mergeRequest,
              mergeCapabilities,
              approvals,
              checks,
              canDeleteBranch,
            })),
          ),
        ),
        Effect.mapError(fail("getChangeRequest")),
        Effect.map(
          ({
            mergeRequest,
            mergeCapabilities,
            approvals,
            checks,
            canDeleteBranch,
          }): ProviderChangeRequestDetail => ({
            ...mergeRequest,
            checks,
            // Changes requested outrank any approval count: GitLab blocks the merge on them
            // while the approvals it already has still read as enough.
            reviewDecision:
              mergeRequest.reviewDecision === "changes-requested"
                ? "changes-requested"
                : ((approvals === null ? null : gitLabApprovalDecision(approvals)) ??
                  mergeRequest.reviewDecision ??
                  null),
            mergeCapabilities,
            viewerPermissions: gitLabViewerPermissions({
              ...mergeRequest,
              approvals,
              canDeleteBranch,
            }),
            // Missing divergence counts mean unknown, not up to date.
            baseComparison:
              mergeRequest.divergedCommits === undefined
                ? "unknown"
                : mergeRequest.divergedCommits > 0
                  ? "behind"
                  : "up-to-date",
            ...(mergeRequest.divergedCommits === undefined
              ? {}
              : { behindBy: mergeRequest.divergedCommits }),
          }),
        ),
      ),

    getChangeRequestActivity: (input) =>
      Effect.all(
        [
          recoverRead(cli.listNotes(input), { comments: [], truncated: true }),
          recoverRead(cli.listCommits(input), []),
          recoverRead(cli.listDiscussions(input), { threads: [], truncated: true }),
          recoverRead(cli.listReactions(input), {
            reactions: [] as ReadonlyArray<PullRequestReaction>,
            reactionsByNoteId: new Map<string, ReadonlyArray<PullRequestReaction>>(),
          }),
        ],
        { concurrency: 4 },
      ).pipe(
        Effect.mapError(fail("getChangeRequestActivity")),
        Effect.map(([notes, commits, discussions, awards]): ProviderChangeRequestActivity => ({
          reactions: awards.reactions,
          comments: notes.comments.map((comment) => ({
            ...comment,
            reactions: awards.reactionsByNoteId.get(comment.id) ?? [],
          })),
          commentCount: notes.comments.length,
          commentsTruncated: notes.truncated || discussions.truncated,
          reviewThreads: discussions.threads.map((thread) => ({
            ...thread,
            comments: thread.comments.map((comment) => ({
              ...comment,
              reactions: awards.reactionsByNoteId.get(comment.id) ?? [],
            })),
          })),
          commits,
        })),
      ),

    getViewerPermissions: (input) =>
      Effect.all([cli.getMergeRequestDetail(input), approvalsOf(input)], { concurrency: 2 }).pipe(
        Effect.flatMap(([mergeRequest, approvals]) =>
          canDeleteBranchOf(input, mergeRequest).pipe(
            Effect.map((canDeleteBranch) =>
              gitLabViewerPermissions({
                viewerCanMerge: mergeRequest.viewerCanMerge,
                approvals,
                canDeleteBranch,
              }),
            ),
          ),
        ),
        Effect.mapError(fail("getViewerPermissions")),
      ),

    getDiff: (input) => cli.getMergeRequestDiff(input).pipe(Effect.mapError(fail("getDiff"))),

    getDiffFileContents: (input) =>
      cli.getMergeRequestDiffFileContents(input).pipe(Effect.mapError(fail("getDiffFileContents"))),

    getFileRevisions: (input) =>
      cli.getFileRevisions(input).pipe(
        Effect.mapError(fail("getFileRevisions")),
        Effect.map((revisions) => ({ revisions })),
      ),

    // MR reviewers are users; groups belong to approval rules.
    listReviewerCandidates: (input) =>
      cli
        .listReviewerCandidates({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
        })
        .pipe(Effect.mapError(fail("listReviewerCandidates"))),

    listRepositoryLabels: (input) =>
      cli
        .listProjectLabels({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          search: input.query,
        })
        .pipe(Effect.mapError(fail("listRepositoryLabels"))),

    searchRepositoryAuthors: (input) =>
      cli
        .listProjectUsers({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          search: input.query,
        })
        .pipe(Effect.mapError(fail("searchRepositoryAuthors"))),

    setReviewerRequest: (input) =>
      cli
        .setReviewerRequest({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          reviewers: input.reviewers,
          requested: input.requested,
        })
        .pipe(Effect.mapError(fail("setReviewerRequest"))),

    runAction: (input) =>
      cli
        .runMergeRequestAction({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          action: input.action,
          ...(input.mergeMethod === undefined ? {} : { mergeMethod: input.mergeMethod }),
        })
        .pipe(Effect.mapError(fail("runAction"))),

    updateChangeRequest: (input) =>
      cli
        .updateMergeRequest({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.body === undefined ? {} : { description: input.body }),
        })
        .pipe(Effect.mapError(fail("updateChangeRequest"))),

    listLabelCandidates: (input) =>
      cli.listLabelCandidates(input).pipe(Effect.mapError(fail("listLabelCandidates"))),

    setLabels: (input) =>
      cli
        .setLabels({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          labels: input.labels,
          applied: input.applied,
        })
        .pipe(Effect.mapError(fail("setLabels"))),

    comment: (input) => cli.commentOnMergeRequest(input).pipe(Effect.mapError(fail("comment"))),

    updateComment: (input) =>
      cli
        .updateNote({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          noteId: input.commentId,
          body: input.body,
        })
        .pipe(Effect.mapError(fail("updateComment"))),

    submitReview: (input) => cli.submitReview(input).pipe(Effect.mapError(fail("submitReview"))),

    replyToThread: (input) =>
      cli
        .replyToDiscussion({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          discussionId: input.threadId,
          body: input.body,
        })
        .pipe(Effect.mapError(fail("replyToThread"))),

    setReaction: (input) =>
      cli
        .setReaction({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          ...(input.subjectId === undefined ? {} : { noteId: input.subjectId }),
          content: input.content,
          reacted: input.reacted,
        })
        .pipe(Effect.mapError(fail("setReaction"))),

    setThreadResolution: (input) =>
      cli
        .setDiscussionResolution({
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
          discussionId: input.threadId,
          resolved: input.resolved,
        })
        .pipe(Effect.mapError(fail("setThreadResolution"))),
  };

  return provider;
});
