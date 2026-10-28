import type { GitHistoryRefsResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildRefsSidebarRows } from "./gitRefsSidebarRows";

const refs: GitHistoryRefsResult = {
  isRepo: true,
  repoRoot: "/repo",
  fingerprint: "fp",
  head: { branch: "main", hash: "h1" },
  branches: [
    { name: "main", hash: "h1", upstream: "origin/main" },
    { name: "fix", hash: "h2", upstream: null },
  ],
  remotes: [
    {
      remote: "origin",
      defaultBranch: "main",
      branches: [{ name: "main", fullName: "origin/main", hash: "h1" }],
    },
  ],
  remoteNames: ["origin"],
  tags: [],
  stashes: [{ index: 0, ref: "stash@{0}", message: "WIP", hash: "s1", baseHash: "h1" }],
  worktrees: [{ path: "/gone", name: "gone", hash: null, branch: null }],
};

describe("buildRefsSidebarRows", () => {
  it("buildRefsSidebarRows should list groups in order and skip empty ones when refs are given", () => {
    const rows = buildRefsSidebarRows(refs, new Set());

    expect(rows.map((row) => row.key)).toEqual([
      "header:branches",
      "branch:main",
      "branch:fix",
      "header:remotes",
      "remote:origin",
      "remote-branch:origin/main",
      "header:stashes",
      "stash:stash@{0}",
      "header:worktrees",
      "worktree:/gone",
    ]);
  });

  it("buildRefsSidebarRows should mark only the root branch as current when it is checked out", () => {
    const rows = buildRefsSidebarRows(refs, new Set());

    expect(rows.filter((row) => row.kind === "ref" && row.current).map((row) => row.key)).toEqual([
      "branch:main",
    ]);
  });

  it("buildRefsSidebarRows should hide a remote's branches when that remote is collapsed", () => {
    const rows = buildRefsSidebarRows(refs, new Set(["origin"]));

    expect(rows.find((row) => row.key === "remote:origin")).toMatchObject({ collapsed: true });
    expect(rows.some((row) => row.key === "remote-branch:origin/main")).toBe(false);
  });

  it("buildRefsSidebarRows should give a stash a non-selecting target and a hashless worktree none when building items", () => {
    const rows = buildRefsSidebarRows(refs, new Set());

    expect(rows.find((row) => row.key === "stash:stash@{0}")).toMatchObject({
      target: { hash: "s1", select: false },
    });
    expect(rows.find((row) => row.key === "worktree:/gone")).toMatchObject({ target: null });
  });
  it("buildRefsSidebarRows should give branches, remote branches and tags a menu target and stashes and worktrees none when building items", () => {
    const rows = buildRefsSidebarRows({ ...refs, tags: [{ name: "v1", hash: "h3" }] }, new Set());
    const menu = (key: string) => {
      const row = rows.find((entry) => entry.key === key);
      return row?.kind === "ref" ? row.menu : undefined;
    };

    expect(menu("branch:fix")).toEqual({ kind: "local", name: "fix", hash: "h2" });
    expect(menu("remote-branch:origin/main")).toEqual({
      kind: "remote",
      fullName: "origin/main",
      hash: "h1",
    });
    expect(menu("tag:v1")).toEqual({ kind: "tag", name: "v1", hash: "h3" });
    expect(menu("stash:stash@{0}")).toBeNull();
    expect(menu("worktree:/gone")).toBeNull();
  });
});
