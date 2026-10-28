import type { GitHistoryRefsResult } from "@t3tools/contracts";

import type { GitMenuTarget } from "./gitContextMenus";

export type GitRefsGroup = "branches" | "remotes" | "tags" | "stashes" | "worktrees";

/** What a click asks for; see `GitRefsSidebar`'s `onSelectRef`. */
interface GitRefsSidebarTarget {
  readonly hash: string;
  readonly select: boolean;
}

export type GitRefsSidebarRow =
  | { readonly kind: "header"; readonly key: string; readonly group: GitRefsGroup }
  | {
      readonly kind: "remote";
      readonly key: string;
      readonly remote: string;
      readonly collapsed: boolean;
    }
  | {
      readonly kind: "ref";
      readonly key: string;
      readonly label: string;
      readonly current: boolean;
      readonly nested: boolean;
      readonly target: GitRefsSidebarTarget | null;
      /** Stashes and worktrees have no menu. */
      readonly menu: GitMenuTarget | null;
    };

/** Flattens the refs into one row list so the sidebar can virtualize it. Empty groups are left out. */
export function buildRefsSidebarRows(
  refs: GitHistoryRefsResult,
  collapsedRemotes: ReadonlySet<string>,
): ReadonlyArray<GitRefsSidebarRow> {
  const rows: GitRefsSidebarRow[] = [];
  const header = (group: GitRefsGroup) =>
    rows.push({ kind: "header", key: `header:${group}`, group });
  const ref = (
    key: string,
    label: string,
    target: GitRefsSidebarTarget | null,
    menu: GitMenuTarget | null,
    nested = false,
  ) => rows.push({ kind: "ref", key, label, current: false, nested, target, menu });

  if (refs.branches.length > 0) {
    header("branches");
    for (const branch of refs.branches) {
      rows.push({
        kind: "ref",
        key: `branch:${branch.name}`,
        label: branch.name,
        current: branch.name === refs.head.branch,
        nested: false,
        target: { hash: branch.hash, select: true },
        menu: { kind: "local", name: branch.name, hash: branch.hash },
      });
    }
  }
  if (refs.remotes.length > 0) {
    header("remotes");
    for (const remote of refs.remotes) {
      const collapsed = collapsedRemotes.has(remote.remote);
      rows.push({
        kind: "remote",
        key: `remote:${remote.remote}`,
        remote: remote.remote,
        collapsed,
      });
      if (collapsed) continue;
      for (const branch of remote.branches) {
        ref(
          `remote-branch:${branch.fullName}`,
          branch.name,
          { hash: branch.hash, select: true },
          { kind: "remote", fullName: branch.fullName, hash: branch.hash },
          true,
        );
      }
    }
  }
  if (refs.tags.length > 0) {
    header("tags");
    for (const tag of refs.tags) {
      ref(
        `tag:${tag.name}`,
        tag.name,
        { hash: tag.hash, select: true },
        { kind: "tag", name: tag.name, hash: tag.hash },
      );
    }
  }
  if (refs.stashes.length > 0) {
    header("stashes");
    for (const stash of refs.stashes) {
      ref(`stash:${stash.ref}`, stash.message, { hash: stash.hash, select: false }, null);
    }
  }
  if (refs.worktrees.length > 0) {
    header("worktrees");
    for (const worktree of refs.worktrees) {
      ref(
        `worktree:${worktree.path}`,
        worktree.name,
        worktree.hash === null ? null : { hash: worktree.hash, select: true },
        null,
      );
    }
  }
  return rows;
}
