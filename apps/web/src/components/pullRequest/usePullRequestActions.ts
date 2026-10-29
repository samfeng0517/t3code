import { useT, type MessageKey } from "~/i18n";
import { useAtomCommand } from "~/state/use-atom-command";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestAction,
  PullRequestDetail,
  PullRequestMergeMethod,
  PullRequestRef,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import {
  capitalizeTerm,
  sourceControlClients,
  type ChangeRequestTerminology,
} from "@t3tools/client-runtime/source-control-clients";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useClientSettings, useEnvironmentSettings } from "~/hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { buildPhysicalToLogicalProjectKeyMap } from "~/sidebarProjectGrouping";
import { useProjects } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { usePreparePullRequestThreadAction } from "~/state/sourceControlActions";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { pullRequestEnvironment } from "~/state/pullRequests";

import { toastManager } from "../ui/toast";
import { offHeadPullRequestCheckoutToast } from "./pullRequestCheckoutToast";
import {
  checkoutFailureDescription,
  handoffPrompt,
  handoffReviewComments,
  readableFailure,
} from "./pullRequestDetail.logic";
import { pullRequestEntryKey, type EnvironmentPullRequestEntry } from "./pullRequestList.logic";

export function usePullRequestDefaultMergeMethodResolver(
  environmentId: EnvironmentId,
  projectId: ProjectId | null,
) {
  const projectDefault = useEnvironmentSettings(
    environmentId,
    (settings) => resolveProjectSettings(settings, projectId).settings.pullRequestMergeMethod,
  );
  const legacyOverrides = useClientSettings((settings) => settings.pullRequestMergeMethodOverrides);
  const grouping = useClientSettings(selectProjectGroupingSettings);
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return () => {
    if (projectDefault != null) return projectDefault;
    if (Object.keys(legacyOverrides).length === 0) return undefined;
    const project = projects.find(
      (candidate) => candidate.environmentId === environmentId && candidate.id === projectId,
    );
    if (!project) return undefined;
    const key =
      buildPhysicalToLogicalProjectKeyMap({
        projects,
        settings: grouping,
        primaryEnvironmentId,
      }).get(derivePhysicalProjectKey(project)) ??
      deriveLogicalProjectKeyFromSettings(project, grouping);
    return legacyOverrides[key];
  };
}

const ACTION_SUCCESS_LABEL_KEYS: Record<PullRequestAction, MessageKey> = {
  merge: "pullRequestDetail.actionSuccess.merge",
  ready: "pullRequestDetail.actionSuccess.ready",
  draft: "pullRequestDetail.actionSuccess.draft",
  close: "pullRequestDetail.actionSuccess.close",
  reopen: "pullRequestDetail.actionSuccess.reopen",
  "update-branch": "pullRequestDetail.actionSuccess.update-branch",
  "enable-auto-merge": "pullRequestDetail.actionSuccess.enable-auto-merge",
  "disable-auto-merge": "pullRequestDetail.actionSuccess.disable-auto-merge",
  revert: "pullRequestDetail.actionSuccess.revert",
  "delete-branch": "pullRequestDetail.actionSuccess.delete-branch",
  "approve-workflows": "pullRequestDetail.actionSuccess.approve-workflows",
  unapprove: "pullRequestDetail.actionSuccess.unapprove",
};

export const ACTION_FAILURE_LABEL_KEYS: Record<PullRequestAction, MessageKey> = {
  merge: "pullRequests.panel.failureLabel.merge",
  ready: "pullRequests.panel.failureLabel.ready",
  draft: "pullRequests.panel.failureLabel.draft",
  close: "pullRequests.panel.failureLabel.close",
  reopen: "pullRequests.panel.failureLabel.reopen",
  "update-branch": "pullRequests.panel.failureLabel.update-branch",
  "enable-auto-merge": "pullRequests.panel.failureLabel.enable-auto-merge",
  "disable-auto-merge": "pullRequests.panel.failureLabel.disable-auto-merge",
  revert: "pullRequests.panel.failureLabel.revert",
  "delete-branch": "pullRequests.panel.failureLabel.delete-branch",
  "approve-workflows": "pullRequests.panel.failureLabel.approve-workflows",
  unapprove: "pullRequests.panel.failureLabel.unapprove",
};

export const ACTION_FAILURE_HINT_KEYS: Record<PullRequestAction, MessageKey> = {
  merge: "pullRequests.panel.failureHint.merge",
  ready: "pullRequests.panel.failureHint.ready",
  draft: "pullRequests.panel.failureHint.draft",
  close: "pullRequests.panel.failureHint.close",
  reopen: "pullRequests.panel.failureHint.reopen",
  "update-branch": "pullRequests.panel.failureHint.update-branch",
  "enable-auto-merge": "pullRequests.panel.failureHint.enable-auto-merge",
  "disable-auto-merge": "pullRequests.panel.failureHint.disable-auto-merge",
  revert: "pullRequests.panel.failureHint.revert",
  "delete-branch": "pullRequests.panel.failureHint.delete-branch",
  "approve-workflows": "pullRequests.panel.failureHint.approve-workflows",
  unapprove: "pullRequests.panel.failureHint.unapprove",
};

export function usePullRequestActionRunner({
  environmentId,
  reference,
  terminology,
  onSuccess,
  resolveMergeMethod,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef | null;
  terminology: ChangeRequestTerminology;
  onSuccess?: (action: PullRequestAction) => void;
  /** Resolve repository settings on click to avoid per-row reads. */
  resolveMergeMethod?: (detail: PullRequestDetail) => PullRequestMergeMethod;
}) {
  const t = useT();
  const runAction = useAtomCommand(pullRequestEnvironment.runAction, {
    reportFailure: false,
  });
  const [actionPending, setActionPending] = useState(false);
  const pendingRef = useRef(false);

  const perform = async (action: PullRequestAction, method?: PullRequestMergeMethod) => {
    if (pendingRef.current || reference === null) return;
    pendingRef.current = true;
    setActionPending(true);
    const result = await runAction({
      environmentId,
      input: {
        ...reference,
        action,
        ...(method ? { mergeMethod: method } : resolveMergeMethod ? { resolveMergeMethod } : {}),
      },
    });
    pendingRef.current = false;
    setActionPending(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: t(ACTION_FAILURE_LABEL_KEYS[action], { singular: terminology.singular }),
        description: readableFailure(
          squashAtomCommandFailure(result),
          t(ACTION_FAILURE_HINT_KEYS[action], { singular: terminology.singular }),
        ),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: t(ACTION_SUCCESS_LABEL_KEYS[action], {
        singular: terminology.singular,
        singularCapitalized: capitalizeTerm(terminology.singular),
      }),
    });
    onSuccess?.(action);
  };

  return { actionPending, perform };
}

export function usePullRequestCloseBatch(onClosed: (entry: EnvironmentPullRequestEntry) => void) {
  const t = useT();
  const runAction = useAtomCommand(pullRequestEnvironment.runAction, { reportFailure: false });
  const pending = useRef(new Set<string>());
  const [closingKeys, setClosingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const close = async (entries: readonly EnvironmentPullRequestEntry[]) => {
    const batch = entries.filter((entry) => {
      const key = pullRequestEntryKey(entry);
      if (entry.state !== "open" || pending.current.has(key)) return false;
      pending.current.add(key);
      return true;
    });
    if (batch.length === 0) return;
    setClosingKeys(new Set(pending.current));
    const failures: string[] = [];
    const outcomes = await Promise.all(
      batch.map(async (entry) => {
        const result = await runAction({
          environmentId: entry.environmentId,
          input: {
            projectId: entry.projectId,
            host: entry.host,
            repository: entry.repository,
            number: entry.number,
            action: "close",
          },
        });
        pending.current.delete(pullRequestEntryKey(entry));
        setClosingKeys(new Set(pending.current));
        if (result._tag === "Failure") {
          failures.push(
            `#${entry.number}: ${readableFailure(squashAtomCommandFailure(result), t(ACTION_FAILURE_HINT_KEYS.close, { singular: sourceControlClients.get(entry.provider).changeRequest.singular }))}`,
          );
          return;
        }
        onClosed(entry);
        return true;
      }),
    );
    const closed = outcomes.filter(Boolean).length;
    toastManager.add({
      type: failures.length > 0 ? "error" : "success",
      title:
        failures.length > 0
          ? t("pullRequestDetail.closeBatch.partial", { closed, total: batch.length })
          : closed === 1
            ? t("pullRequestDetail.closeBatch.one")
            : t("pullRequestDetail.closeBatch.other", { count: closed }),
      ...(failures.length > 0 ? { description: failures.slice(0, 3).join("\n") } : {}),
    });
  };
  return { close, closingKeys };
}

export interface PullRequestThreadTask {
  prompt: string;
  reviewComments?: ReadonlyArray<ReviewCommentContext>;
}

export type PullRequestHandoffDetail = Pick<
  PullRequestDetail,
  "projectId" | "workspaceRoot" | "url"
>;

const lastHandoffPromptByDraft = new Map<DraftId, string>();

export function usePullRequestHandoffs({
  environmentId,
  detail,
}: {
  environmentId: EnvironmentId;
  detail: PullRequestHandoffDetail | null;
}) {
  const t = useT();
  const newThread = useNewThreadHandler();
  const prepareThread = usePreparePullRequestThreadAction({
    environmentId,
    cwd: detail?.workspaceRoot ?? null,
  });
  // Serialize all handoffs because they check out the same pull request.
  const [handoff, setHandoff] = useState<string | null>(null);
  // Prompt links hand over a URL alone, so the URL is what names the host.
  const terminology = (
    (detail && sourceControlClients.findByChangeRequestUrl(detail.url)) ||
    sourceControlClients.get(undefined)
  ).changeRequest;

  // Questions must not change checkouts or create worktrees.
  const openThreadWithTask = async (
    projectRef: ReturnType<typeof scopeProjectRef>,
    task: PullRequestThreadTask | null,
    opened?: { draftId: DraftId },
  ): Promise<{ draftId: DraftId } | null> => {
    const session =
      opened ??
      (await newThread(projectRef).then(
        (result) => result,
        () => null,
      ));
    if (session === null) return null;
    const store = useComposerDraftStore.getState();
    if (task === null) return session;
    const draft = store.getComposerDraft(session.draftId);
    const existingComments = draft?.reviewComments ?? [];
    const prompt = handoffPrompt(
      {
        prompt: draft?.prompt ?? "",
        lastHandoffPrompt: lastHandoffPromptByDraft.get(session.draftId),
      },
      task.prompt,
    );
    // Track only the handoff contribution so later handoffs preserve user text.
    lastHandoffPromptByDraft.set(session.draftId, task.prompt);
    store.setPrompt(session.draftId, prompt);
    store.setReviewComments(
      session.draftId,
      handoffReviewComments(existingComments, task.reviewComments ?? []),
    );
    return session;
  };

  const startAsk = async (kind: string, task: PullRequestThreadTask) => {
    if (!detail || handoff !== null) return;
    setHandoff(kind);
    const projectRef = scopeProjectRef(environmentId, detail.projectId);
    const opened = await openThreadWithTask(projectRef, task);
    setHandoff(null);
    if (opened === null) {
      toastManager.add({
        type: "error",
        title: t("pullRequests.panel.openThreadFailed"),
        description: t("pullRequests.panel.openThreadHint"),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: t("pullRequests.panel.askedInThread"),
      description:
        task.prompt.length > 0
          ? t("pullRequests.panel.questionInComposer")
          : t("pullRequests.panel.targetInComposer", { singular: terminology.singular }),
    });
  };

  const startHandoff = async (
    kind: string,
    task: PullRequestThreadTask | null,
    mode: "worktree" | "local" = "worktree",
  ) => {
    if (!detail || handoff !== null) return;
    setHandoff(kind);
    // Explicit timeouts survive toast updates and would pin the result after loading.
    const toastId = toastManager.add({
      type: "loading",
      title: t("pullRequests.panel.preparingCheckout", { singular: terminology.singular }),
    });
    const projectRef = scopeProjectRef(environmentId, detail.projectId);
    // Checkout setup requires the thread to exist first.
    const opened = await newThread(projectRef).then(
      (session) => session,
      () => null,
    );
    if (opened === null) {
      setHandoff(null);
      toastManager.update(toastId, {
        type: "error",
        title: t("pullRequests.panel.openCheckoutThreadFailed"),
        description: t("pullRequests.panel.openThreadHint"),
      });
      return;
    }
    const prepared = await prepareThread.run({
      reference: detail.url,
      mode,
      threadId: opened.threadId,
    });
    if (prepared._tag === "Failure") {
      setHandoff(null);
      toastManager.update(toastId, {
        type: "error",
        title: t("pullRequests.panel.prepareCheckoutFailed", { singular: terminology.singular }),
        description: checkoutFailureDescription(
          isAtomCommandInterrupted(prepared) ? undefined : squashAtomCommandFailure(prepared),
          t,
        ),
      });
      return;
    }
    const pointed = await newThread(projectRef, {
      branch: prepared.value.branch,
      worktreePath: prepared.value.worktreePath,
      envMode: prepared.value.worktreePath === null ? "local" : "worktree",
    }).then(
      (session) => session !== null,
      () => false,
    );
    if (!pointed) {
      setHandoff(null);
      toastManager.update(toastId, {
        type: "error",
        title: t("pullRequests.panel.threadStayedTitle"),
        description: t("pullRequests.panel.threadStayedDescription", {
          branch: prepared.value.branch,
        }),
      });
      return;
    }
    setHandoff(null);
    if (task === null) {
      toastManager.update(
        toastId,
        prepared.value.isOnPullRequestHead
          ? {
              type: "success",
              title:
                mode === "local"
                  ? t("pullRequests.panel.checkedOutHere")
                  : t("pullRequests.panel.checkedOut"),
              description:
                mode === "local"
                  ? t("pullRequests.panel.checkedOutHereDescription", {
                      singular: terminology.singular,
                    })
                  : t("pullRequests.panel.checkedOutWorktreeDescription", {
                      singular: terminology.singular,
                    }),
            }
          : offHeadPullRequestCheckoutToast(terminology, t),
      );
      return;
    }
    await openThreadWithTask(projectRef, task, opened);
    toastManager.update(
      toastId,
      prepared.value.isOnPullRequestHead
        ? {
            type: "success",
            title: t("pullRequests.panel.checkoutReady"),
            description: t("pullRequests.panel.taskInComposer"),
          }
        : offHeadPullRequestCheckoutToast(terminology, t),
    );
  };

  return { handoff, startAsk, startHandoff };
}
