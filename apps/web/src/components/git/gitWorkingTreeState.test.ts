import type { GitWorkingTreeFile } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  countPatchLines,
  defaultStashMessage,
  graphRowIds,
  reconcileFileSelection,
  resolveGraphSelection,
  UNCOMMITTED_ROW_ID,
  workingTreeSections,
} from "./gitWorkingTreeState";

const file = (overrides: Partial<GitWorkingTreeFile> & { path: string }): GitWorkingTreeFile => ({
  previousPath: null,
  indexStatus: null,
  worktreeStatus: null,
  conflicted: false,
  ...overrides,
});

describe("workingTreeSections", () => {
  it("should put a partially staged file in both sections when index and worktree differ", () => {
    const sections = workingTreeSections([
      file({ path: "a.ts", indexStatus: "modified", worktreeStatus: "modified" }),
      file({ path: "new.ts", worktreeStatus: "untracked" }),
      file({ path: "b.ts", previousPath: "old.ts", indexStatus: "renamed" }),
    ]);
    expect(sections.staged).toEqual([
      {
        section: "staged",
        path: "a.ts",
        previousPath: null,
        letter: "M",
        conflicted: false,
        diffArea: "staged",
      },
      {
        section: "staged",
        path: "b.ts",
        previousPath: "old.ts",
        letter: "R",
        conflicted: false,
        diffArea: "staged",
      },
    ]);
    expect(sections.unstaged).toEqual([
      {
        section: "unstaged",
        path: "a.ts",
        previousPath: null,
        letter: "M",
        conflicted: false,
        diffArea: "unstaged",
      },
      {
        section: "unstaged",
        path: "new.ts",
        previousPath: null,
        letter: "U",
        conflicted: false,
        diffArea: "untracked",
      },
    ]);
  });

  it("should list a conflicted file only in unstaged when it is unmerged", () => {
    const sections = workingTreeSections([
      file({ path: "c.ts", worktreeStatus: "modified", conflicted: true }),
    ]);
    expect(sections.staged).toEqual([]);
    expect(sections.unstaged).toEqual([
      {
        section: "unstaged",
        path: "c.ts",
        previousPath: null,
        letter: "M",
        conflicted: true,
        diffArea: "unstaged",
      },
    ]);
  });
});

describe("reconcileFileSelection", () => {
  it("should move the selection to the other section when its file was staged", () => {
    const sections = workingTreeSections([
      file({ path: "z.ts", indexStatus: "added" }),
      file({ path: "a.ts", indexStatus: "modified" }),
    ]);
    expect(reconcileFileSelection({ section: "unstaged", path: "a.ts" }, sections)).toEqual({
      section: "staged",
      path: "a.ts",
    });
  });

  it("should fall back to the first row when the selected file disappeared", () => {
    const sections = workingTreeSections([
      file({ path: "u.ts", worktreeStatus: "modified" }),
      file({ path: "s.ts", indexStatus: "modified" }),
    ]);
    expect(reconcileFileSelection({ section: "unstaged", path: "gone.ts" }, sections)).toEqual({
      section: "staged",
      path: "s.ts",
    });
    expect(reconcileFileSelection(null, workingTreeSections([]))).toBeNull();
  });
});

describe("graphRowIds", () => {
  it("should prepend the uncommitted row when there are uncommitted changes", () => {
    expect(graphRowIds(["h1", "h2"], true)).toEqual([UNCOMMITTED_ROW_ID, "h1", "h2"]);
    expect(graphRowIds(["h1", "h2"], false)).toEqual(["h1", "h2"]);
  });
});

describe("resolveGraphSelection", () => {
  const base = {
    historyStatus: "ready" as const,
    headHash: "head",
    commitHashes: ["head", "older"],
    stashHashes: ["stash1"],
    hasUncommitted: false,
    workingTreeLoaded: true,
  };

  it("should select HEAD when the selected uncommitted row disappears", () => {
    expect(resolveGraphSelection({ ...base, selected: UNCOMMITTED_ROW_ID })).toEqual({
      selected: "head",
      scrollTo: "head",
    });
    expect(
      resolveGraphSelection({ ...base, selected: UNCOMMITTED_ROW_ID, workingTreeLoaded: false }),
    ).toEqual({ selected: UNCOMMITTED_ROW_ID, scrollTo: null });
  });

  it("should select HEAD when the selected stash no longer exists", () => {
    expect(resolveGraphSelection({ ...base, selected: "stash2" })).toEqual({
      selected: "head",
      scrollTo: null,
    });
    expect(resolveGraphSelection({ ...base, selected: "stash2", commitHashes: ["older"] })).toEqual(
      { selected: null, scrollTo: null },
    );
    expect(resolveGraphSelection({ ...base, selected: "stash1" })).toEqual({
      selected: "stash1",
      scrollTo: null,
    });
  });
});

describe("countPatchLines", () => {
  it("should ignore file headers when counting added and removed lines", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      "+more",
      " same",
      "",
      "[truncated]",
    ].join("\n");
    expect(countPatchLines(diff)).toEqual({ insertions: 2, deletions: 1 });
  });
});

describe("defaultStashMessage", () => {
  it("should use the no branch form when HEAD is detached", () => {
    expect(
      defaultStashMessage({ branch: null, hash: "0123456789abcdef", subject: "fix bug" }),
    ).toBe("WIP on (no branch): 0123456 fix bug");
    expect(defaultStashMessage({ branch: "main", hash: "0123456789abcdef", subject: null })).toBe(
      "WIP on main: 0123456",
    );
    expect(defaultStashMessage({ branch: "main", hash: null, subject: null })).toBe("WIP on main");
  });
});
