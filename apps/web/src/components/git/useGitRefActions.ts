import {
  type AtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  GitBranchNotFullyMergedError,
  type GitHistoryRefsResult,
  GitStashConflictError,
  GitStashMovedError,
  GitStashPartiallyAppliedError,
  type ThreadId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useT } from "~/i18n";
import { readLocalApi } from "~/localApi";
import { readThreadShell } from "~/state/entities";
import { gitEnvironment } from "~/state/git";
import { orchestrationEnvironment } from "~/state/orchestration";
import { threadFamilies } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { vcsEnvironment } from "~/state/vcs";

import { toastManager } from "../ui/toast";
import { threadsUsingBranch, worktreeHoldingThread } from "./gitActionGuards";
import { buildGitMenu, type GitMenuAction, type GitMenuTarget } from "./gitContextMenus";
import { SHORT_HASH_LENGTH } from "./gitHistoryState";
import type { GitRefNameChoice, GitRefNameRequest } from "./GitRefNameDialog";
import type { useGitConfirm } from "./useGitConfirm";
import type { GitWriteActions } from "./useGitWriteActions";

const PUSH_TAG_PREFIX = "push-tag:";

const isNotFullyMerged = Schema.is(GitBranchNotFullyMergedError);
const isStashMoved = Schema.is(GitStashMovedError);
const isStashConflict = Schema.is(GitStashConflictError);
const isStashPartiallyApplied = Schema.is(GitStashPartiallyAppliedError);

type GitStashTarget = Extract<GitMenuTarget, { readonly kind: "stash" }>;
type GitWorktreeTarget = Extract<GitMenuTarget, { readonly kind: "worktree" }>;

/** Splits `origin/feature` by the refs' own remote list, since remote names can contain `/`. */
function remoteBranchOf(refs: GitHistoryRefsResult | null, fullName: string) {
  for (const remote of refs?.remotes ?? []) {
    const branch = remote.branches.find((candidate) => candidate.fullName === fullName);
    if (branch !== undefined) {
      return {
        remoteName: remote.remote,
        branchName: branch.name,
        isDefault: remote.defaultBranch === branch.name,
      };
    }
  }
  return null;
}

export interface GitRefNamePrompt {
  readonly request: GitRefNameRequest;
  readonly finish: (choice: GitRefNameChoice | null) => void;
}

/** The commit and ref menu, its name dialog, confirms and guards, on top of the page's write lock. */
export function useGitRefActions(input: {
  readonly environmentId: EnvironmentId;
  readonly refs: GitHistoryRefsResult | null;
  readonly writes: GitWriteActions;
  readonly confirm: ReturnType<typeof useGitConfirm>;
}) {
  const t = useT();
  const { environmentId, refs, writes } = input;
  const { confirm, confirmAgentWork, projectInRepo, threads } = input.confirm;
  const commandOptions = { reportFailure: false };
  const switchRefCommand = useAtomCommand(vcsEnvironment.switchRef, commandOptions);
  const createRefCommand = useAtomCommand(vcsEnvironment.createRef, commandOptions);
  const renameBranchCommand = useAtomCommand(vcsEnvironment.renameBranch, commandOptions);
  const deleteBranchCommand = useAtomCommand(vcsEnvironment.deleteBranch, commandOptions);
  const createTagCommand = useAtomCommand(gitEnvironment.createTag, commandOptions);
  const deleteTagCommand = useAtomCommand(gitEnvironment.deleteTag, commandOptions);
  const pushTagCommand = useAtomCommand(gitEnvironment.pushTag, commandOptions);
  const deleteRemoteBranchCommand = useAtomCommand(
    gitEnvironment.deleteRemoteBranch,
    commandOptions,
  );
  const stashActionCommand = useAtomCommand(gitEnvironment.stashAction, commandOptions);
  const removeWorktreeCommand = useAtomCommand(vcsEnvironment.removeWorktree, commandOptions);
  const loadWorktreeThreadIds = useAtomQueryRunner(orchestrationEnvironment.worktreeThreadIds, {
    reportFailure: false,
    refresh: true,
  });
  const loadThreadFamily = useAtomQueryRunner(
    (target: { readonly threadId: ThreadId }) =>
      threadFamilies.familyAtom(environmentId, target.threadId),
    { reportFailure: false },
  );
  const { copyToClipboard } = useCopyToClipboard({
    onCopy: () => toastManager.add({ type: "success", title: t("git.toast.copiedHash") }),
    onError: (error) =>
      toastManager.add({ type: "error", title: t("git.toast.failed"), description: error.message }),
  });
  const [namePrompt, setNamePrompt] = useState<GitRefNamePrompt | null>(null);

  const askName = (request: GitRefNameRequest) =>
    new Promise<GitRefNameChoice | null>((resolve) => {
      setNamePrompt({
        request,
        finish: (choice) => {
          setNamePrompt(null);
          resolve(choice);
        },
      });
    });

  const checkout = async (cwd: string, target: GitMenuTarget) => {
    // A full hash checks out detached; a remote branch's full name makes the server switch to
    // (or create) its local tracking branch.
    const ref =
      target.kind === "commit"
        ? target.hash
        : target.kind === "remote"
          ? target.fullName
          : target.kind === "local"
            ? target.name
            : null;
    if (ref === null || !(await confirmAgentWork(cwd, "checkout"))) return;
    await writes.run(
      "checkout",
      () => switchRefCommand({ environmentId, input: { cwd, refName: ref } }),
      (value) =>
        t("git.toast.switched", {
          ref:
            target.kind === "commit"
              ? target.hash.slice(0, SHORT_HASH_LENGTH)
              : (value.refName ?? ref),
        }),
    );
  };

  const createBranch = async (cwd: string, hash: string) => {
    const choice = await askName({ kind: "create-branch" });
    if (choice === null) return;
    if (choice.switchRef && !(await confirmAgentWork(cwd, "checkout"))) return;
    await writes.run(
      "create-branch",
      () =>
        createRefCommand({
          environmentId,
          input: { cwd, refName: choice.name, startPoint: hash, switchRef: choice.switchRef },
        }),
      () => t("git.toast.createdBranch", { name: choice.name }),
    );
  };

  const createTag = async (cwd: string, hash: string) => {
    const choice = await askName({ kind: "create-tag" });
    if (choice === null) return;
    await writes.run(
      "create-tag",
      () => createTagCommand({ environmentId, input: { cwd, tagName: choice.name, target: hash } }),
      () => t("git.toast.createdTag", { name: choice.name }),
    );
  };

  const renameBranch = async (cwd: string, oldName: string) => {
    const choice = await askName({ kind: "rename", name: oldName });
    if (choice === null) return;
    await writes.run(
      "rename-branch",
      () => renameBranchCommand({ environmentId, input: { cwd, oldName, newName: choice.name } }),
      () => t("git.toast.renamed", { old: oldName, new: choice.name }),
    );
  };

  const deleteBranch = async (cwd: string, name: string) => {
    if (!(await confirm(t("git.confirm.deleteBranch", { name }), { destructive: true }))) return;
    const deleted = () => t("git.toast.deletedBranch", { name });
    // An unmerged branch is a question for the user, not a failure toast.
    const outcome = await writes.run(
      "delete-branch",
      async (): Promise<AtomCommandResult<"deleted" | "not-merged", unknown>> => {
        const result = await deleteBranchCommand({
          environmentId,
          input: { cwd, refName: name, force: false },
        });
        if (result._tag === "Success") return AsyncResult.success("deleted");
        if (isNotFullyMerged(squashAtomCommandFailure(result))) {
          return AsyncResult.success("not-merged");
        }
        return AsyncResult.failure(result.cause);
      },
      (value) => (value === "deleted" ? deleted() : null),
    );
    if (outcome !== "not-merged") return;
    if (!(await confirm(t("git.confirm.forceDeleteBranch", { name }), { destructive: true })))
      return;
    await writes.run(
      "delete-branch",
      () => deleteBranchCommand({ environmentId, input: { cwd, refName: name, force: true } }),
      deleted,
    );
  };

  const deleteRemoteBranch = async (cwd: string, fullName: string) => {
    const remote = remoteBranchOf(refs, fullName);
    if (remote === null) return;
    const { remoteName, branchName } = remote;
    if (
      !(await confirm(
        t("git.confirm.deleteRemoteBranch", { remote: remoteName, name: branchName }),
        { destructive: true },
      ))
    )
      return;
    await writes.run(
      "delete-remote-branch",
      () => deleteRemoteBranchCommand({ environmentId, input: { cwd, remoteName, branchName } }),
      () => t("git.toast.deletedRemoteBranch", { name: fullName }),
    );
  };

  const deleteTag = async (cwd: string, name: string) => {
    if (!(await confirm(t("git.confirm.deleteTag", { name }), { destructive: true }))) return;
    await writes.run(
      "delete-tag",
      () => deleteTagCommand({ environmentId, input: { cwd, tagName: name } }),
      () => t("git.toast.deletedTag", { name }),
    );
  };

  const pushTag = async (cwd: string, name: string, remoteName: string) => {
    await writes.run(
      "push-tag",
      () => pushTagCommand({ environmentId, input: { cwd, tagName: name, remoteName } }),
      () => t("git.toast.pushedTag", { name, remote: remoteName }),
    );
  };

  /** Stash failures get their own toast; the page refreshes on settle either way. */
  const runStash = async (
    cwd: string,
    target: GitStashTarget,
    action: "apply" | "pop" | "drop",
    successToast: () => string,
  ) => {
    await writes.run(
      `${action}-stash`,
      async (): Promise<AtomCommandResult<boolean, unknown>> => {
        const result = await stashActionCommand({
          environmentId,
          input: { cwd, action, index: target.index, hash: target.hash },
        });
        if (result._tag === "Success") return AsyncResult.success(true);
        const error = squashAtomCommandFailure(result);
        const handled = isStashMoved(error)
          ? t("git.toast.stashMoved")
          : isStashConflict(error)
            ? error.action === "pop"
              ? t("git.toast.stashPopConflict")
              : t("git.toast.stashApplyConflict")
            : isStashPartiallyApplied(error)
              ? t("git.toast.stashPartiallyApplied")
              : null;
        if (handled === null) return AsyncResult.failure(result.cause);
        toastManager.add({ type: "error", title: handled });
        return AsyncResult.success(false);
      },
      (succeeded) => (succeeded ? successToast() : null),
    );
  };

  const applyStash = async (cwd: string, target: GitStashTarget, pop: boolean) => {
    if (!(await confirmAgentWork(cwd, "applyStash"))) return;
    await runStash(cwd, target, pop ? "pop" : "apply", () =>
      pop ? t("git.toast.poppedStash") : t("git.toast.appliedStash"),
    );
  };

  const dropStash = async (cwd: string, target: GitStashTarget) => {
    const message = t("git.confirm.deleteStash", { ref: target.ref, message: target.message });
    const confirmed = await confirm(message, {
      destructive: true,
      confirmLabel: t("git.menu.delete"),
    });
    if (!confirmed) return;
    await runStash(cwd, target, "drop", () => t("git.toast.deletedStash"));
  };

  /** The first thread still holding the worktree; settled and archived threads let it go. */
  const worktreeHolder = async (path: string) => {
    const ids = await loadWorktreeThreadIds({ environmentId, input: { worktreePath: path } });
    if (ids._tag !== "Success") return "unknown" as const;
    return worktreeHoldingThread({
      threadIds: ids.value.threadIds,
      shellOf: (threadId) => readThreadShell(scopeThreadRef(environmentId, threadId)),
      familyOf: async (threadId) => {
        const family = await loadThreadFamily({ threadId });
        return family._tag === "Success" ? family.value.threads : null;
      },
    });
  };

  const deleteWorktree = async (cwd: string, target: GitWorktreeTarget) => {
    const message = t("git.confirm.deleteWorktree", { path: target.path });
    const confirmed = await confirm(message, {
      destructive: true,
      confirmLabel: t("git.menu.delete"),
    });
    if (!confirmed) return;
    await writes.run(
      "delete-worktree",
      () =>
        removeWorktreeCommand({ environmentId, input: { cwd, path: target.path, force: true } }),
      () => t("git.toast.deletedWorktree", { name: target.name }),
    );
  };

  const perform = async (cwd: string, target: GitMenuTarget, action: GitMenuAction) => {
    if (target.kind === "worktree") {
      if (action === "copy-hash" && target.hash !== null) {
        return copyToClipboard(target.hash, undefined);
      }
      if (action === "delete") return deleteWorktree(cwd, target);
      return;
    }
    if (action === "copy-hash") return copyToClipboard(target.hash, undefined);
    if (action === "checkout") return checkout(cwd, target);
    if (action === "create-branch") return createBranch(cwd, target.hash);
    if (action === "create-tag") return createTag(cwd, target.hash);
    if (action === "rename" && target.kind === "local") return renameBranch(cwd, target.name);
    if (action === "delete" && target.kind === "local") return deleteBranch(cwd, target.name);
    if (action === "delete" && target.kind === "remote") {
      return deleteRemoteBranch(cwd, target.fullName);
    }
    if (action === "delete" && target.kind === "tag") return deleteTag(cwd, target.name);
    if (action === "delete" && target.kind === "stash") return dropStash(cwd, target);
    if (action === "apply-stash" && target.kind === "stash") return applyStash(cwd, target, false);
    if (action === "pop-stash" && target.kind === "stash") return applyStash(cwd, target, true);
    if (action.startsWith(PUSH_TAG_PREFIX) && target.kind === "tag") {
      return pushTag(cwd, target.name, action.slice(PUSH_TAG_PREFIX.length));
    }
  };

  const openMenu = async (target: GitMenuTarget, position: { x: number; y: number }) => {
    const api = readLocalApi();
    const repoRoot = refs?.repoRoot ?? null;
    if (!api || refs === null || repoRoot === null) return;
    const worktreePaths = refs.worktrees.map((worktree) => worktree.path);
    const branchThreads =
      target.kind === "local"
        ? await threadsUsingBranch({
            threads,
            projectInRepo: projectInRepo(repoRoot, worktreePaths),
            environmentId,
            repoRoot,
            worktreePaths,
            branch: target.name,
          })
        : [];
    const holder =
      target.kind === "worktree" && writes.canWrite && target.path !== repoRoot
        ? await worktreeHolder(target.path)
        : null;
    const inUseBy =
      branchThreads[0]?.title ?? (holder !== null && holder !== "unknown" ? holder.title : null);
    const items = buildGitMenu(target, {
      canWrite: writes.canWrite,
      isOnline: writes.isOnline,
      pending: writes.pending !== null,
      inUseBy,
      threadCheckFailed: holder === "unknown",
      isCurrentWorktree: target.kind === "worktree" && target.path === repoRoot,
      isCurrentBranch: target.kind === "local" && target.name === refs.head.branch,
      isRemoteDefaultBranch:
        target.kind === "remote" && remoteBranchOf(refs, target.fullName)?.isDefault === true,
      remoteNames: refs.remoteNames,
    });
    const clicked = await settlePromise(() => api.contextMenu.show(items, position));
    if (clicked._tag === "Failure" || clicked.value === null) return;
    await perform(repoRoot, target, clicked.value);
  };

  return { openMenu, namePrompt };
}
