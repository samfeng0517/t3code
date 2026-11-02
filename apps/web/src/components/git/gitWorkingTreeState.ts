import type {
  GitWorkingTreeDiffArea,
  GitWorkingTreeFile,
  GitWorkingTreeFileDiffInput,
  GitWorkingTreeFileStatus,
} from "@t3tools/contracts";

import { type GitHistoryState, SHORT_HASH_LENGTH } from "./gitHistoryState";

/** The graph row for uncommitted changes; never a valid object hash. */
export const UNCOMMITTED_ROW_ID = "uncommitted";

export type WorkingTreeSection = "staged" | "unstaged";
export type WorkingTreeLetter = "M" | "A" | "D" | "R" | "U";

export interface WorkingTreeRow {
  readonly section: WorkingTreeSection;
  readonly path: string;
  readonly previousPath: string | null;
  readonly letter: WorkingTreeLetter;
  readonly conflicted: boolean;
  readonly diffArea: GitWorkingTreeDiffArea;
}

export interface WorkingTreeSections {
  readonly staged: WorkingTreeRow[];
  readonly unstaged: WorkingTreeRow[];
}

export interface WorkingTreeFileSelection {
  readonly section: WorkingTreeSection;
  readonly path: string;
}

const LETTERS: Record<GitWorkingTreeFileStatus, WorkingTreeLetter> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

export function workingTreeSections(files: ReadonlyArray<GitWorkingTreeFile>): WorkingTreeSections {
  const staged: WorkingTreeRow[] = [];
  const unstaged: WorkingTreeRow[] = [];
  for (const file of files) {
    if (file.indexStatus !== null) {
      staged.push({
        section: "staged",
        path: file.path,
        previousPath: file.previousPath,
        letter: LETTERS[file.indexStatus],
        conflicted: file.conflicted,
        diffArea: "staged",
      });
    }
    // The server reports every conflict with a worktree status, so conflicts land here too.
    if (file.worktreeStatus !== null) {
      unstaged.push({
        section: "unstaged",
        path: file.path,
        previousPath: null,
        letter: LETTERS[file.worktreeStatus],
        conflicted: file.conflicted,
        diffArea: file.worktreeStatus === "untracked" ? "untracked" : "unstaged",
      });
    }
  }
  return { staged, unstaged };
}

export function reconcileFileSelection(
  selection: WorkingTreeFileSelection | null,
  sections: WorkingTreeSections,
): WorkingTreeFileSelection | null {
  if (selection !== null) {
    const same = sections[selection.section];
    if (same.some((row) => row.path === selection.path)) return selection;
    const otherSection = selection.section === "staged" ? "unstaged" : "staged";
    if (sections[otherSection].some((row) => row.path === selection.path)) {
      return { section: otherSection, path: selection.path };
    }
  }
  const first = sections.staged[0] ?? sections.unstaged[0];
  return first === undefined ? null : { section: first.section, path: first.path };
}

/** A loaded diff is shown only for the row it was read for. */
export function diffBelongsToRow(
  input: GitWorkingTreeFileDiffInput,
  row: WorkingTreeRow | null,
): boolean {
  return (
    row !== null &&
    input.path === row.path &&
    input.previousPath === row.previousPath &&
    input.area === row.diffArea
  );
}

export function graphRowIds(
  hashes: ReadonlyArray<string>,
  hasUncommitted: boolean,
): ReadonlyArray<string> {
  return hasUncommitted ? [UNCOMMITTED_ROW_ID, ...hashes] : hashes;
}

/**
 * `undefined` means no initial pick yet, so later reloads keep whatever the user chose.
 * A selection that vanished (committed, stashed, dropped) falls back to HEAD.
 */
export function resolveGraphSelection(input: {
  readonly selected: string | null | undefined;
  readonly historyStatus: GitHistoryState["status"];
  readonly headHash: string | null;
  readonly commitHashes: ReadonlyArray<string>;
  readonly stashHashes: ReadonlyArray<string>;
  readonly hasUncommitted: boolean;
  readonly workingTreeLoaded: boolean;
}): { selected: string | null | undefined; scrollTo: string | null } {
  const { selected, historyStatus, headHash, commitHashes, stashHashes } = input;
  const loadedHead = headHash !== null && commitHashes.includes(headHash) ? headHash : null;
  if (selected === undefined) {
    if (historyStatus !== "ready") return { selected, scrollTo: null };
    const initial = loadedHead ?? commitHashes[0] ?? null;
    return { selected: initial, scrollTo: initial };
  }
  if (selected === UNCOMMITTED_ROW_ID) {
    if (input.workingTreeLoaded && !input.hasUncommitted) {
      return { selected: loadedHead, scrollTo: loadedHead };
    }
    return { selected, scrollTo: null };
  }
  if (
    selected !== null &&
    historyStatus !== "loading" &&
    !commitHashes.includes(selected) &&
    !stashHashes.includes(selected)
  ) {
    return { selected: loadedHead, scrollTo: null };
  }
  return { selected, scrollTo: null };
}

export function countPatchLines(diff: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) insertions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { insertions, deletions };
}

/** Git's own default, `WIP on <branch>: <short hash> <subject>`. */
export function defaultStashMessage(input: {
  readonly branch: string | null;
  readonly hash: string | null;
  readonly subject: string | null;
}): string {
  const prefix = `WIP on ${input.branch ?? "(no branch)"}`;
  if (input.hash === null) return prefix;
  const shortHash = input.hash.slice(0, SHORT_HASH_LENGTH);
  return input.subject === null
    ? `${prefix}: ${shortHash}`
    : `${prefix}: ${shortHash} ${input.subject}`;
}
