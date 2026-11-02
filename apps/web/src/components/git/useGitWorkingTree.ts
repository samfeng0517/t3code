import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  GitCommitFileDiffResult,
  GitWorkingTreeFileDiffInput,
  GitWorkingTreeStatusResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { gitEnvironment } from "~/state/git";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  diffBelongsToRow,
  reconcileFileSelection,
  type WorkingTreeFileSelection,
  type WorkingTreeRow,
  type WorkingTreeSections,
  workingTreeSections,
} from "./gitWorkingTreeState";

export interface GitWorkingTreeDiff {
  readonly input: GitWorkingTreeFileDiffInput;
  readonly result: GitCommitFileDiffResult;
}

export interface GitWorkingTreeController {
  readonly status: GitWorkingTreeStatusResult | null;
  readonly statusError: unknown;
  readonly sections: WorkingTreeSections;
  readonly selection: WorkingTreeFileSelection | null;
  readonly selectedRow: WorkingTreeRow | null;
  /** The selected row's diff; the previous one stays while the same row reloads. */
  readonly diff: GitWorkingTreeDiff | null;
  readonly diffLoading: boolean;
  readonly diffError: unknown;
  readonly select: (selection: WorkingTreeFileSelection) => void;
  readonly reload: () => Promise<void>;
  readonly retryDiff: () => void;
}

/** Async work reads and writes this instead of render values; see `GitHistorySession`. */
interface GitWorkingTreeSession {
  generation: number;
  sections: WorkingTreeSections;
  selection: WorkingTreeFileSelection | null;
  reloading: Promise<void> | null;
  reloadAgain: boolean;
  diffRequest: number;
}

const EMPTY_SECTIONS: WorkingTreeSections = { staged: [], unstaged: [] };

const failureError = <A, E>(result: AtomCommandResult<A, E>): unknown =>
  AsyncResult.isFailure(result) ? Cause.squash(result.cause) : null;

const findRow = (
  sections: WorkingTreeSections,
  selection: WorkingTreeFileSelection | null,
): WorkingTreeRow | null =>
  selection === null
    ? null
    : (sections[selection.section].find((row) => row.path === selection.path) ?? null);

/** The uncommitted changes of one repository: status, file selection and the selected diff. */
export function useGitWorkingTree(target: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}): GitWorkingTreeController {
  const { environmentId, cwd } = target;
  const statusCommand = useAtomCommand(gitEnvironment.workingTreeStatus, { reportFailure: false });
  const fileDiffCommand = useAtomCommand(gitEnvironment.workingTreeFileDiff, {
    reportFailure: false,
  });
  const [status, setStatus] = useState<GitWorkingTreeStatusResult | null>(null);
  const [statusError, setStatusError] = useState<unknown>(null);
  const [selection, setSelection] = useState<WorkingTreeFileSelection | null>(null);
  const [diff, setDiff] = useState<GitWorkingTreeDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<unknown>(null);
  const session = useRef<GitWorkingTreeSession>({
    generation: 0,
    sections: EMPTY_SECTIONS,
    selection: null,
    reloading: null,
    reloadAgain: false,
    diffRequest: 0,
  });

  const loadDiff = async (row: WorkingTreeRow | null) => {
    const current = session.current;
    const generation = current.generation;
    current.diffRequest += 1;
    const request = current.diffRequest;
    if (row === null) {
      setDiff(null);
      setDiffError(null);
      setDiffLoading(false);
      return;
    }
    const input: GitWorkingTreeFileDiffInput = {
      cwd,
      path: row.path,
      previousPath: row.previousPath,
      area: row.diffArea,
    };
    setDiffLoading(true);
    setDiffError(null);
    const result = await fileDiffCommand({ environmentId, input });
    if (current.generation !== generation || current.diffRequest !== request) return;
    setDiffLoading(false);
    if (AsyncResult.isSuccess(result)) {
      setDiff({ input, result: result.value });
      setDiffError(null);
    } else {
      setDiffError(failureError(result));
    }
  };

  const applySelection = (next: WorkingTreeFileSelection | null) => {
    const current = session.current;
    current.selection = next;
    setSelection(next);
    void loadDiff(findRow(current.sections, next));
  };

  const reloadOnce = async (generation: number) => {
    const current = session.current;
    const result = await statusCommand({ environmentId, input: { cwd } });
    if (current.generation !== generation) return;
    if (!AsyncResult.isSuccess(result)) {
      setStatusError(failureError(result));
      return;
    }
    current.sections = workingTreeSections(result.value.files);
    setStatus(result.value);
    setStatusError(null);
    applySelection(reconcileFileSelection(current.selection, current.sections));
  };

  const reload = (): Promise<void> => {
    const current = session.current;
    if (current.reloading !== null) {
      // The running read may predate the change this call reports, so it goes around once more.
      current.reloadAgain = true;
      return current.reloading;
    }
    const generation = current.generation;
    const run = async () => {
      let again = true;
      while (again && current.generation === generation) {
        current.reloadAgain = false;
        await reloadOnce(generation);
        again = current.reloadAgain;
      }
      if (current.generation === generation) current.reloading = null;
    };
    current.reloading = run();
    return current.reloading;
  };

  const dispose = () => {
    const current = session.current;
    current.generation += 1;
    current.reloading = null;
    current.reloadAgain = false;
  };

  const stableSelect = useStableCallback(applySelection);
  const stableReload = useStableCallback(reload);
  const stableRetryDiff = useStableCallback(() => {
    const current = session.current;
    void loadDiff(findRow(current.sections, current.selection));
  });
  const stableDispose = useStableCallback(dispose);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops in-flight status and diff reads on unmount
  useEffect(() => stableDispose, [stableDispose]);

  const sections = status === null ? EMPTY_SECTIONS : workingTreeSections(status.files);
  const selectedRow = findRow(sections, selection);

  return {
    status,
    statusError,
    sections,
    selection,
    selectedRow,
    diff: diff !== null && diffBelongsToRow(diff.input, selectedRow) ? diff : null,
    diffLoading,
    diffError,
    select: stableSelect,
    reload: stableReload,
    retryDiff: stableRetryDiff,
  };
}
