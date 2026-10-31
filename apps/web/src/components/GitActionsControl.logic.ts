import type {
  GitRunStackedActionResult,
  GitStackedAction,
  VcsStatusResult,
} from "@t3tools/contracts";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import type { ChangeRequestTerminology } from "@t3tools/client-runtime/source-control-clients";
import {
  changeRequestTerminologyFor,
  type DefaultBranchActionDialogCopy,
  type DefaultBranchConfirmableAction,
  type GitActionIconName,
  type GitDialogAction,
} from "@t3tools/client-runtime/state/vcs";
import type { MessageKey, Translate } from "~/i18n";
import { formatMessage } from "~/i18n/locale";
import { en } from "~/i18n/messages/en";

export {
  requiresDefaultBranchConfirmation,
  type DefaultBranchConfirmableAction,
  type GitActionIconName,
} from "@t3tools/client-runtime/state/vcs";

export interface GitActionMenuItem {
  id: "commit" | "push" | "pr";
  label: string;
  disabled: boolean;
  icon: GitActionIconName;
  kind: "open_dialog";
  dialogAction?: GitDialogAction;
}

export interface GitQuickAction {
  label: string;
  disabled: boolean;
  kind: "run_action" | "run_pull" | "open_publish" | "show_hint";
  action?: GitStackedAction;
  hint?: string;
}

export interface GitActionProgressPresentation {
  readonly status: string;
  readonly output: string | null;
  readonly startedAtMs: number | null;
}

export interface GitActionResultToastTiming {
  readonly timeout: 0;
  readonly dismissAfterVisibleMs: number | null;
}

export const GIT_ACTION_SUCCESS_VISIBLE_MS = 10_000;

// Tests and non-React callers get English; components pass the active locale's `t`.
const englishT: Translate = (key, params) => formatMessage(en[key], params);

// Progress labels and result titles arrive as English text from the server; unknown text stays as-is.
const KNOWN_GIT_TEXT: Readonly<Record<string, MessageKey>> = {
  "Pulling latest changes...": "gitActions.progress.pulling",
  "Generating commit message...": "gitActions.progress.generatingCommitMessage",
  "Committing...": "gitActions.progress.committing",
  "Preparing feature branch...": "gitActions.progress.preparingFeatureBranch",
  "Pushing...": "gitActions.progress.pushing",
  "Committed changes": "gitActions.toast.committedChanges",
  Done: "common.done",
};

// Server-side templates (GitManager result titles and progress labels, vcsAction hook labels).
const GIT_TEXT_PATTERNS: ReadonlyArray<readonly [RegExp, MessageKey]> = [
  [/^Committed (?<sha>[0-9a-f]+)$/, "gitActions.serverText.committedSha"],
  [/^Pushed (?<sha>[0-9a-f]+) to (?<branch>.+)$/, "gitActions.serverText.pushedShaTo"],
  [/^Pushed to (?<branch>.+)$/, "gitActions.serverText.pushedTo"],
  [/^Pushed (?<sha>[0-9a-f]+)$/, "gitActions.serverText.pushedSha"],
  [/^Pushed$/, "gitActions.serverText.pushed"],
  [/^Created (?<label>\S+) #(?<number>\d+)$/, "gitActions.serverText.createdNumber"],
  [/^Created (?<label>\S+)$/, "gitActions.serverText.created"],
  [/^Opened (?<label>\S+) #(?<number>\d+)$/, "gitActions.serverText.openedNumber"],
  [/^Opened (?<label>\S+)$/, "gitActions.serverText.opened"],
  [/^Generating (?<label>.+) content\.\.\.$/, "gitActions.serverText.generatingContent"],
  [/^Creating (?<label>.+)\.\.\.$/, "gitActions.serverText.creating"],
  [/^Preparing (?<label>.+)\.\.\.$/, "gitActions.serverText.preparing"],
  [/^Running (?<hook>.+)\.\.\.$/, "gitActions.serverText.runningHook"],
];

export function translateGitActionText(text: string, t: Translate): string {
  const key = KNOWN_GIT_TEXT[text];
  if (key !== undefined) return t(key);
  for (const [pattern, patternKey] of GIT_TEXT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return t(patternKey, match.groups);
  }
  return text;
}

export function resolveGitActionResultToastTiming(
  type: "error" | "success",
): GitActionResultToastTiming {
  return {
    timeout: 0,
    dismissAfterVisibleMs: type === "success" ? GIT_ACTION_SUCCESS_VISIBLE_MS : null,
  };
}

export function resolveGitActionProgressPresentation(
  input: {
    readonly isRunning: boolean;
    readonly operation: string | null;
    readonly currentLabel: string | null;
    readonly lastOutputLine: string | null;
    readonly phaseStartedAtMs: number | null;
    readonly hookStartedAtMs: number | null;
  },
  t: Translate = englishT,
): GitActionProgressPresentation | null {
  if (
    !input.isRunning ||
    (input.operation !== "run_change_request" && input.operation !== "pull")
  ) {
    return null;
  }

  const currentLabel = input.currentLabel?.trim();
  const output = input.lastOutputLine?.trim();
  const isPull = input.operation === "pull";
  return {
    status:
      currentLabel && currentLabel !== "Running source control action"
        ? translateGitActionText(currentLabel, t)
        : isPull
          ? t("gitActions.progress.pulling")
          : t("gitActions.progress.starting"),
    output: !isPull && output ? output : null,
    startedAtMs: isPull
      ? input.phaseStartedAtMs
      : (input.hookStartedAtMs ?? input.phaseStartedAtMs),
  };
}

export function formatGitActionElapsed(startedAtMs: number | null, nowMs: number): string | null {
  if (startedAtMs === null) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1_000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function buildMenuItems(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  hasPrimaryRemote = true,
  t: Translate = englishT,
): GitActionMenuItem[] {
  if (!gitStatus) return [];
  const terminology = changeRequestTerminologyFor(gitStatus);

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0;
  const canPushWithoutUpstream = hasPrimaryRemote && !gitStatus.hasUpstream;
  const canCommit = !isBusy && hasChanges;
  const canPush =
    !isBusy &&
    hasBranch &&
    !isBehind &&
    gitStatus.aheadCount > 0 &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canCreatePr =
    !isBusy &&
    hasBranch &&
    !hasOpenPr &&
    hasDefaultBranchDelta &&
    !isBehind &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);

  const commitItem: GitActionMenuItem = {
    id: "commit",
    label: t("gitActions.action.commit"),
    disabled: !canCommit,
    icon: "commit",
    kind: "open_dialog",
    dialogAction: "commit",
  };

  if (!hasPrimaryRemote) {
    return [commitItem];
  }

  const pushItem: GitActionMenuItem = {
    id: "push",
    label: t("gitActions.action.push"),
    disabled: !canPush,
    icon: "push",
    kind: "open_dialog",
    dialogAction: "push",
  };

  if (hasOpenPr) {
    return [commitItem, pushItem];
  }

  return [
    commitItem,
    pushItem,
    {
      id: "pr",
      label: t("gitActions.action.createChangeRequest", {
        changeRequest: terminology.shortLabel,
      }),
      disabled: !canCreatePr,
      icon: "pr",
      kind: "open_dialog",
      dialogAction: "create_pr",
    },
  ];
}

export function resolveQuickAction(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  isDefaultRef = false,
  hasPrimaryRemote = true,
  t: Translate = englishT,
): GitQuickAction {
  const commitLabel = t("gitActions.action.commit");
  const pushLabel = t("gitActions.action.push");
  if (isBusy) {
    return {
      label: commitLabel,
      disabled: true,
      kind: "show_hint",
      hint: t("gitActions.hint.inProgress"),
    };
  }

  if (!gitStatus) {
    return {
      label: commitLabel,
      disabled: true,
      kind: "show_hint",
      hint: t("gitActions.hint.statusUnavailable"),
    };
  }

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0;
  const isBehind = gitStatus.behindCount > 0;
  const isDiverged = isAhead && isBehind;
  const terminology = changeRequestTerminologyFor(gitStatus);

  if (!hasBranch) {
    return {
      label: commitLabel,
      disabled: true,
      kind: "show_hint",
      hint: t("gitActions.hint.detachedHead", { changeRequest: terminology.singular }),
    };
  }

  if (hasChanges) {
    if (isBehind || (!gitStatus.hasUpstream && !hasPrimaryRemote)) {
      return { label: commitLabel, disabled: false, kind: "run_action", action: "commit" };
    }
    if (hasOpenPr || isDefaultRef) {
      return {
        label: t("gitActions.action.commitPush"),
        disabled: false,
        kind: "run_action",
        action: "commit_push",
      };
    }
    return {
      label: t("gitActions.action.commitPushChangeRequest", {
        changeRequest: terminology.shortLabel,
      }),
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    };
  }

  if (!gitStatus.hasUpstream) {
    if (!hasPrimaryRemote) {
      return {
        label: t("gitActions.action.publishRepository"),
        disabled: false,
        kind: "open_publish",
      };
    }
    if (!isAhead) {
      if (hasOpenPr) {
        return {
          label: commitLabel,
          disabled: true,
          kind: "show_hint",
          hint: t("gitActions.hint.upToDate"),
        };
      }
      return {
        label: pushLabel,
        disabled: true,
        kind: "show_hint",
        hint: t("gitActions.hint.noLocalCommits"),
      };
    }
    if (hasOpenPr || isDefaultRef) {
      return {
        label: pushLabel,
        disabled: false,
        kind: "run_action",
        action: isDefaultRef ? "commit_push" : "push",
      };
    }
    return {
      label: t("gitActions.action.pushCreateChangeRequest", {
        changeRequest: terminology.shortLabel,
      }),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (isDiverged) {
    return {
      label: t("gitActions.action.syncRef"),
      disabled: true,
      kind: "show_hint",
      hint: t("gitActions.hint.diverged"),
    };
  }

  if (isBehind) {
    return {
      label: t("gitActions.action.pull"),
      disabled: false,
      kind: "run_pull",
    };
  }

  if (isAhead) {
    if (hasOpenPr || isDefaultRef) {
      return {
        label: pushLabel,
        disabled: false,
        kind: "run_action",
        action: isDefaultRef ? "commit_push" : "push",
      };
    }
    return {
      label: t("gitActions.action.pushCreateChangeRequest", {
        changeRequest: terminology.shortLabel,
      }),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (hasOpenPr && gitStatus.hasUpstream) {
    return {
      label: commitLabel,
      disabled: true,
      kind: "show_hint",
      hint: t("gitActions.hint.upToDate"),
    };
  }

  if (hasDefaultBranchDelta && !isDefaultRef) {
    return {
      label: t("gitActions.action.createChangeRequest", {
        changeRequest: terminology.shortLabel,
      }),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  return {
    label: commitLabel,
    disabled: true,
    kind: "show_hint",
    hint: t("gitActions.hint.upToDate"),
  };
}

export function resolveDefaultBranchActionDialogCopy(input: {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  terminology: ChangeRequestTerminology;
  t?: Translate;
}): DefaultBranchActionDialogCopy {
  const t = input.t ?? englishT;
  const branch = input.branchName;
  const changeRequest = input.terminology.shortLabel;
  const changeRequestName = input.terminology.singular;

  if (input.action === "push" || input.action === "commit_push") {
    if (input.includesCommit) {
      return {
        title: t("gitActions.defaultBranch.commitPushTitle"),
        description: t("gitActions.defaultBranch.commitPushDescription", { branch }),
        continueLabel: t("gitActions.defaultBranch.commitPushContinue", { branch }),
      };
    }
    return {
      title: t("gitActions.defaultBranch.pushTitle"),
      description: t("gitActions.defaultBranch.pushDescription", { branch }),
      continueLabel: t("gitActions.defaultBranch.pushContinue", { branch }),
    };
  }

  if (input.includesCommit) {
    return {
      title: t("gitActions.defaultBranch.commitPushCreateTitle", { changeRequest }),
      description: t("gitActions.defaultBranch.commitPushCreateDescription", {
        branch,
        changeRequestName,
      }),
      continueLabel: t("gitActions.defaultBranch.commitPushCreateContinue", { changeRequest }),
    };
  }
  return {
    title: t("gitActions.defaultBranch.pushCreateTitle", { changeRequest }),
    description: t("gitActions.defaultBranch.pushCreateDescription", {
      branch,
      changeRequestName,
    }),
    continueLabel: t("gitActions.action.pushCreateChangeRequest", { changeRequest }),
  };
}

/** Clean trees cannot create feature branches because the server derives names from uncommitted changes. */
export function resolveFeatureBranchUnavailableReason(input: {
  branchName: string;
  hasWorkingTreeChanges: boolean;
  t?: Translate;
}): string | null {
  if (input.hasWorkingTreeChanges) return null;
  const t = input.t ?? englishT;
  return t("gitActions.defaultBranch.featureBranchUnavailable", { branch: input.branchName });
}

export function resolveThreadBranchUpdate(
  result: GitRunStackedActionResult,
): { branch: string } | null {
  if (result.branch.status !== "created" || !result.branch.name) {
    return null;
  }

  return {
    branch: result.branch.name,
  };
}

export function resolveThreadBranchMetadataPatch(
  branch: string | null,
  expectedBranch: string | null,
): {
  branch: string | null;
  expectedBranch: string | null;
} {
  return { branch, expectedBranch };
}

export function resolveLiveThreadBranchUpdate(input: {
  threadBranch: string | null;
  gitStatus: VcsStatusResult | null;
}): { branch: string | null } | null {
  if (!input.gitStatus) {
    return null;
  }

  if (input.gitStatus.refName === null && input.threadBranch !== null) {
    return null;
  }

  if (input.threadBranch === input.gitStatus.refName) {
    return null;
  }

  if (
    input.threadBranch !== null &&
    input.gitStatus.refName !== null &&
    !isTemporaryWorktreeBranch(input.threadBranch) &&
    isTemporaryWorktreeBranch(input.gitStatus.refName)
  ) {
    return null;
  }

  return {
    branch: input.gitStatus.refName,
  };
}
