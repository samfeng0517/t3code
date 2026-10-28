import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  GitBranchNotFullyMergedError,
  type GitHistoryRefsResult,
  type ProjectId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useT } from "~/i18n";
import { readLocalApi } from "~/localApi";
import { readProject, useQuietThreadShells } from "~/state/entities";
import { gitEnvironment } from "~/state/git";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";

import { toastManager } from "../ui/toast";
import { activeRootThreads, projectInRepoChecker, threadsUsingBranch } from "./gitActionGuards";
import { buildGitMenu, type GitMenuAction, type GitMenuTarget } from "./gitContextMenus";
import { SHORT_HASH_LENGTH } from "./gitHistoryState";
import type { GitRefNameChoice, GitRefNameRequest } from "./GitRefNameDialog";
import type { GitWriteActions } from "./useGitWriteActions";

const PUSH_TAG_PREFIX = "push-tag:";

const isNotFullyMerged = Schema.is(GitBranchNotFullyMergedError);

export interface GitRefNamePrompt {
  readonly request: GitRefNameRequest;
  readonly finish: (choice: GitRefNameChoice | null) => void;
}

/** The commit and ref menu, its name dialog, confirms and guards, on top of the page's write lock. */
export function useGitRefActions(input: {
  readonly environmentId: EnvironmentId;
  readonly refs: GitHistoryRefsResult | null;
  readonly writes: GitWriteActions;
}) {
  const t = useT();
  const { environmentId, refs, writes } = input;
  const threads = useQuietThreadShells();
  const commandOptions = { reportFailure: false };
  const switchRefCommand = useAtomCommand(vcsEnvironment.switchRef, commandOptions);
  const createRefCommand = useAtomCommand(vcsEnvironment.createRef, commandOptions);
  const renameBranchCommand = useAtomCommand(vcsEnvironment.renameBranch, commandOptions);
  const deleteBranchCommand = useAtomCommand(vcsEnvironment.deleteBranch, commandOptions);
  const createTagCommand = useAtomCommand(gitEnvironment.createTag, commandOptions);
  const deleteTagCommand = useAtomCommand(gitEnvironment.deleteTag, commandOptions);
  const pushTagCommand = useAtomCommand(gitEnvironment.pushTag, commandOptions);
  const historyRefsCommand = useAtomCommand(gitEnvironment.historyRefs, commandOptions);
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

  const confirm = async (message: string, destructive = false) => {
    const api = readLocalApi();
    if (!api) return false;
    const result = await settlePromise(() =>
      api.dialogs.confirm(message, destructive ? { variant: "destructive" } : undefined),
    );
    return result._tag === "Success" && result.value;
  };

  // A fresh checker per action, so a lookup never outlives the threads and projects it read.
  const projectInRepo = (repoRoot: string, worktreePaths?: ReadonlyArray<string>) =>
    projectInRepoChecker({
      projectRootOf: (projectId: ProjectId) =>
        readProject(scopeProjectRef(environmentId, projectId))?.workspaceRoot ?? null,
      repoRoot,
      showToplevel: async (cwd) => {
        const result = await historyRefsCommand({ environmentId, input: { cwd } });
        return result._tag === "Success" ? result.value.repoRoot : null;
      },
      ...(worktreePaths === undefined ? {} : { worktreePaths }),
    });

  /** A checkout changes the files under local-mode threads, so running ones are named first. */
  const confirmCheckout = async (repoRoot: string) => {
    const active = await activeRootThreads({
      threads,
      projectInRepo: projectInRepo(repoRoot),
      environmentId,
      repoRoot,
    });
    if (active.length === 0) return Promise.resolve(true);
    const titles = active
      .map((thread) => t("git.confirm.threadTitle", { title: thread.title }))
      .join(t("git.confirm.threadTitleSeparator"));
    return confirm(t("git.confirm.checkoutActive", { titles }));
  };

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
    if (ref === null || !(await confirmCheckout(cwd))) return;
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
    if (choice.switchRef && !(await confirmCheckout(cwd))) return;
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
    if (!(await confirm(t("git.confirm.deleteBranch", { name }), true))) return;
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
    if (!(await confirm(t("git.confirm.forceDeleteBranch", { name }), true))) return;
    await writes.run(
      "delete-branch",
      () => deleteBranchCommand({ environmentId, input: { cwd, refName: name, force: true } }),
      deleted,
    );
  };

  const deleteTag = async (cwd: string, name: string) => {
    if (!(await confirm(t("git.confirm.deleteTag", { name }), true))) return;
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

  const perform = async (cwd: string, target: GitMenuTarget, action: GitMenuAction) => {
    if (action === "copy-hash") return copyToClipboard(target.hash, undefined);
    if (action === "checkout") return checkout(cwd, target);
    if (action === "create-branch") return createBranch(cwd, target.hash);
    if (action === "create-tag") return createTag(cwd, target.hash);
    if (action === "rename" && target.kind === "local") return renameBranch(cwd, target.name);
    if (action === "delete" && target.kind === "local") return deleteBranch(cwd, target.name);
    if (action === "delete" && target.kind === "tag") return deleteTag(cwd, target.name);
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
    const inUseBy = branchThreads[0]?.title ?? null;
    const items = buildGitMenu(target, {
      canWrite: writes.canWrite,
      isOnline: writes.isOnline,
      pending: writes.pending !== null,
      inUseBy,
      isCurrentBranch: target.kind === "local" && target.name === refs.head.branch,
      remoteNames: refs.remoteNames,
    });
    const clicked = await settlePromise(() => api.contextMenu.show(items, position));
    if (clicked._tag === "Failure" || clicked.value === null) return;
    await perform(repoRoot, target, clicked.value);
  };

  return { openMenu, namePrompt };
}
