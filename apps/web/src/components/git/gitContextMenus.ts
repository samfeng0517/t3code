import type { ContextMenuItem } from "@t3tools/contracts";

import { t } from "~/i18n";

import { SHORT_HASH_LENGTH } from "./gitHistoryState";

export type GitMenuTarget =
  | { readonly kind: "commit"; readonly hash: string }
  | { readonly kind: "local"; readonly name: string; readonly hash: string }
  | { readonly kind: "remote"; readonly fullName: string; readonly hash: string }
  | { readonly kind: "tag"; readonly name: string; readonly hash: string };

/** Opens the menu for `target` at a viewport position. */
export type GitOpenMenu = (target: GitMenuTarget, position: { x: number; y: number }) => void;

export type GitMenuAction =
  | "checkout"
  | "create-branch"
  | "create-tag"
  | "rename"
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
  /** Title of the first thread recorded on this branch. */
  readonly inUseBy: string | null;
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
  }
}

/** One menu for a commit or ref, shared by graph rows, ref labels, the refs sidebar and the detail's "⋯" button. */
export function buildGitMenu(
  target: GitMenuTarget,
  context: GitMenuContext,
): ContextMenuItem<GitMenuAction>[] {
  const copy: ContextMenuItem<GitMenuAction> = {
    id: "copy-hash",
    label: t("git.menu.copyHash"),
    icon: "copy",
  };
  if (!context.canWrite) return [copy];
  const blocked = !context.isOnline || context.pending;
  const items: ContextMenuItem<GitMenuAction>[] = writeItems(target, context).map((item) =>
    blocked ? { ...item, disabled: true } : item,
  );
  items.push({ ...copy, separatorBefore: true });
  if (target.kind === "local" && context.inUseBy !== null) {
    items.push({
      id: "in-use",
      label: t("git.menu.inUse", { title: context.inUseBy }),
      header: true,
      separatorBefore: true,
    });
  }
  return items;
}
