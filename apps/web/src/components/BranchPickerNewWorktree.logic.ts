import type { VcsRef } from "@t3tools/contracts";

type CheckoutRef = Pick<VcsRef, "worktreePath" | "name" | "isRemote" | "remoteName">;

/**
 * Git checks a branch out in one place at a time. The server prefers a local
 * branch over a remote ref of the same name, so a remote ref inherits the
 * checkout state of its local counterpart.
 */
export function canCheckOutInNewWorktree(
  ref: CheckoutRef,
  branchByName: ReadonlyMap<string, Pick<VcsRef, "worktreePath">>,
): boolean {
  if (ref.worktreePath !== null) return false;
  if (!ref.isRemote || !ref.remoteName) return true;
  const remotePrefix = `${ref.remoteName}/`;
  if (!ref.name.startsWith(remotePrefix)) return true;
  const localTwin = branchByName.get(ref.name.slice(remotePrefix.length));
  return localTwin === undefined || localTwin.worktreePath === null;
}

/**
 * A selection made while new branches were on can name a branch that is already
 * checked out, which an existing-branch worktree cannot use.
 */
export function shouldClearExistingBranchSelection(input: {
  createsBranch: boolean;
  isSelectingWorktreeBase: boolean;
  selectedRef: CheckoutRef | null;
  branchByName: ReadonlyMap<string, Pick<VcsRef, "worktreePath">>;
}): boolean {
  return (
    !input.createsBranch &&
    input.isSelectingWorktreeBase &&
    input.selectedRef !== null &&
    !canCheckOutInNewWorktree(input.selectedRef, input.branchByName)
  );
}

// Human launches always sync the base with origin first; the server keeps
// omitted as false for non-human callers.
export function resolveNewWorktreeBranchOptions(input: { createsBranch: boolean }): {
  readonly existingBranch?: true;
  readonly startFromOrigin: true;
} {
  if (!input.createsBranch) return { existingBranch: true, startFromOrigin: true };
  return { startFromOrigin: true };
}
