import { describe, expect, it } from "vite-plus/test";

import {
  canCheckOutInNewWorktree,
  resolveNewWorktreeBranchOptions,
  shouldClearExistingBranchSelection,
} from "./BranchPickerNewWorktree.logic";

const localRef = (name: string, worktreePath: string | null = null) => ({
  name,
  worktreePath,
});
const remoteRef = (remoteName: string, name: string, worktreePath: string | null = null) => ({
  name: `${remoteName}/${name}`,
  isRemote: true,
  remoteName,
  worktreePath,
});
const byName = (...refs: ReadonlyArray<ReturnType<typeof localRef>>) =>
  new Map(refs.map((ref) => [ref.name, ref] as const));

describe("canCheckOutInNewWorktree", () => {
  it("allows a free local branch and rejects one checked out elsewhere", () => {
    expect(canCheckOutInNewWorktree(localRef("feature"), byName())).toBe(true);
    expect(canCheckOutInNewWorktree(localRef("feature", "/repo"), byName())).toBe(false);
  });

  it("allows a remote ref with no local counterpart or a free one", () => {
    expect(canCheckOutInNewWorktree(remoteRef("upstream", "feature"), byName())).toBe(true);
    expect(
      canCheckOutInNewWorktree(remoteRef("upstream", "feature"), byName(localRef("feature"))),
    ).toBe(true);
  });

  it("rejects a remote ref whose local counterpart is checked out, whatever the remote", () => {
    const branches = byName(localRef("feature/x", "/repo"));
    expect(canCheckOutInNewWorktree(remoteRef("origin", "feature/x"), branches)).toBe(false);
    expect(canCheckOutInNewWorktree(remoteRef("upstream", "feature/x"), branches)).toBe(false);
  });
});

describe("shouldClearExistingBranchSelection", () => {
  const checkedOut = { name: "feature", worktreePath: "/repo" };
  const free = { name: "feature", worktreePath: null };
  const branchByName = byName();

  it("drops a branch that is checked out elsewhere once new branches are off", () => {
    expect(
      shouldClearExistingBranchSelection({
        createsBranch: false,
        isSelectingWorktreeBase: true,
        selectedRef: checkedOut,
        branchByName,
      }),
    ).toBe(true);
  });

  it("keeps a free branch, a base for a new branch, and selections outside a new worktree", () => {
    for (const input of [
      { createsBranch: false, isSelectingWorktreeBase: true, selectedRef: free },
      { createsBranch: true, isSelectingWorktreeBase: true, selectedRef: checkedOut },
      { createsBranch: false, isSelectingWorktreeBase: false, selectedRef: checkedOut },
      { createsBranch: false, isSelectingWorktreeBase: true, selectedRef: null },
    ]) {
      expect(shouldClearExistingBranchSelection({ ...input, branchByName })).toBe(false);
    }
  });
});

describe("shouldClearExistingBranchSelection with remote refs", () => {
  it("drops a remote ref whose local counterpart is checked out elsewhere", () => {
    expect(
      shouldClearExistingBranchSelection({
        createsBranch: false,
        isSelectingWorktreeBase: true,
        selectedRef: remoteRef("upstream", "feature"),
        branchByName: byName(localRef("feature", "/repo")),
      }),
    ).toBe(true);
  });
});

describe("resolveNewWorktreeBranchOptions", () => {
  it("resolveNewWorktreeBranchOptions should request a synced existing branch when new branches are off", () => {
    expect(resolveNewWorktreeBranchOptions({ createsBranch: false })).toEqual({
      existingBranch: true,
      startFromOrigin: true,
    });
  });

  it("resolveNewWorktreeBranchOptions should request a synced new branch when new branches are on", () => {
    expect(resolveNewWorktreeBranchOptions({ createsBranch: true })).toEqual({
      startFromOrigin: true,
    });
  });
});
