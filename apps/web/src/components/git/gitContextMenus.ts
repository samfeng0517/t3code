import type { ContextMenuItem } from "@t3tools/contracts";

import { t } from "~/i18n";

import { SHORT_HASH_LENGTH } from "./gitHistoryState";

export type GitMenuTarget =
  | { readonly kind: "commit"; readonly hash: string }
  | { readonly kind: "local"; readonly name: string; readonly hash: string }
  | { readonly kind: "remote"; readonly fullName: string; readonly hash: string }
  | { readonly kind: "tag"; readonly name: string; readonly hash: string }
  | {
      readonly kind: "stash";
      readonly index: number;
      readonly ref: string;
      readonly message: string;
      /** The full stash commit hash; the server rejects a pop or drop whose hash moved. */
      readonly hash: string;
    }
  | {
      readonly kind: "worktree";
      readonly path: string;
      readonly name: string;
      /** Null for a worktree without a commit, which offers no hash to copy. */
      readonly hash: string | null;
    };

/** Opens the menu for `target` at a viewport position. */
export type GitOpenMenu = (target: GitMenuTarget, position: { x: number; y: number }) => void;

export type GitMenuAction =
  | "checkout"
  | "create-branch"
  | "create-tag"
  | "rename"
  | "apply-stash"
  | "pop-stash"
  | "delete"
  | "push-tag"
  | `push-tag:${string}`
  | "in-use"
  | "copy-hash";

export interface GitMenuContext {
  readonly canWrite: boolean;
  readonly isOnline: boolean;
  /** Another write holds the page's write lock. */
  readonly pending: boolean;
  /** Title of the first thread recorded on this branch, or of an unsettled thread in this worktree. */
  readonly inUseBy: string | null;
  /** The worktree's threads could not be read, so deleting it is not offered. */
  readonly threadCheckFailed: boolean;
  /** The worktree is the checkout the page is showing. */
  readonly isCurrentWorktree: boolean;
  /** The branch is checked out at the repository root. */
  readonly isCurrentBranch: boolean;
  /** The remote branch is the one its remote's HEAD points at. */
  readonly isRemoteDefaultBranch: boolean;
  readonly remoteNames: ReadonlyArray<string>;
}

function writeItems(
  target: GitMenuTarget,
  context: GitMenuContext,
): ContextMenuItem<GitMenuAction>[] {
  switch (target.kind) {
    case "commit":
      return [
        {
          id: "checkout",
          label: t("git.menu.checkoutCommit", { hash: target.hash.slice(0, SHORT_HASH_LENGTH) }),
        },
        { id: "create-branch", label: t("git.menu.createBranch") },
        { id: "create-tag", label: t("git.menu.createTag") },
      ];
    case "local": {
      const inUse = context.inUseBy !== null;
      return [
        { id: "checkout", label: t("git.menu.checkout"), disabled: context.isCurrentBranch },
        { id: "rename", label: t("git.menu.rename"), disabled: inUse },
        {
          id: "delete",
          label: t("git.menu.delete"),
          destructive: true,
          disabled: inUse || context.isCurrentBranch,
        },
      ];
    }
    case "remote":
      return [
        { id: "checkout", label: t("git.menu.checkout") },
        {
          id: "delete",
          label: t("git.menu.delete"),
          destructive: true,
          disabled: context.isRemoteDefaultBranch,
        },
      ];
    case "tag": {
      const [onlyRemote, ...otherRemotes] = context.remoteNames;
      const label = t("git.menu.pushTag");
      const push: ContextMenuItem<GitMenuAction> =
        onlyRemote === undefined
          ? { id: "push-tag", label, disabled: true }
          : otherRemotes.length === 0
            ? { id: `push-tag:${onlyRemote}`, label }
            : {
                id: "push-tag",
                label,
                children: context.remoteNames.map((remote) => ({
                  id: `push-tag:${remote}` as const,
                  label: remote,
                })),
              };
      return [push, { id: "delete", label: t("git.menu.delete"), destructive: true }];
    }
    case "stash":
      return [
        { id: "apply-stash", label: t("git.menu.applyStash") },
        { id: "pop-stash", label: t("git.menu.popStash") },
        { id: "delete", label: t("git.menu.delete"), destructive: true },
      ];
    case "worktree":
      return [
        {
          id: "delete",
          label: t("git.menu.deleteWorktree"),
          destructive: true,
          disabled:
            context.inUseBy !== null || context.threadCheckFailed || context.isCurrentWorktree,
        },
      ];
  }
}

/** One menu for a commit, ref, stash or worktree, shared by graph rows, ref labels, the refs sidebar and the detail's "⋯" button. */
export function buildGitMenu(
  target: GitMenuTarget,
  context: GitMenuContext,
): ContextMenuItem<GitMenuAction>[] {
  const copy: ContextMenuItem<GitMenuAction>[] =
    target.hash === null ? [] : [{ id: "copy-hash", label: t("git.menu.copyHash"), icon: "copy" }];
  if (!context.canWrite) return copy;
  const blocked = !context.isOnline || context.pending;
  const items: ContextMenuItem<GitMenuAction>[] = writeItems(target, context).map((item) =>
    blocked ? { ...item, disabled: true } : item,
  );
  items.push(...copy.map((item) => ({ ...item, separatorBefore: true })));
  const inUse =
    target.kind === "local" && context.inUseBy !== null
      ? t("git.menu.inUse", { title: context.inUseBy })
      : target.kind !== "worktree"
        ? null
        : context.isCurrentWorktree
          ? t("git.menu.worktreeCurrent")
          : context.inUseBy !== null
            ? t("git.menu.worktreeInUse", { title: context.inUseBy })
            : context.threadCheckFailed
              ? t("git.menu.worktreeCheckFailed")
              : null;
  if (inUse !== null) {
    items.push({ id: "in-use", label: inUse, header: true, separatorBefore: true });
  }
  return items;
}

export type GitWorkingTreeMenuAction = "stash-changes" | "discard-all";

/** The uncommitted changes panel's "⋯" menu; it has no read-only items. */
export function buildWorkingTreeMenu(
  context: Pick<GitMenuContext, "canWrite" | "isOnline" | "pending">,
): ContextMenuItem<GitWorkingTreeMenuAction>[] {
  if (!context.canWrite) return [];
  const disabled = !context.isOnline || context.pending;
  return [
    { id: "stash-changes", label: t("git.workingTree.stashChanges"), disabled },
    {
      id: "discard-all",
      label: t("git.workingTree.discardAll"),
      destructive: true,
      separatorBefore: true,
      disabled,
    },
  ];
}
