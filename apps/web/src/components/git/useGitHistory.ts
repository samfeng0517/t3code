import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  GitHistoryLogResult,
  GitHistoryRefsResult,
  ProjectId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { useQuietThreadShells } from "~/state/entities";
import { useEnvironment } from "~/state/environments";
import { gitEnvironment } from "~/state/git";
import { useAtomCommand } from "~/state/use-atom-command";

import { computeGraphLayout, type GraphLayout } from "./gitGraphLayout";
import {
  buildRefLabels,
  endedTurnThreadKeys,
  type GitHistoryEvent,
  gitHistoryReducer,
  type GitHistoryPageRequest,
  type GitHistoryState,
  type GitRefLabel,
  initialGitHistoryState,
  planJump,
  reloadHistoryPages,
  shouldRetryFirstLoad,
  shouldRetryLateFailure,
} from "./gitHistoryState";

export interface GitHistoryTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cwd: string;
}

export interface GitHistoryController {
  readonly state: GitHistoryState;
  readonly layout: GraphLayout;
  readonly labels: ReadonlyMap<string, ReadonlyArray<GitRefLabel>>;
  readonly refs: GitHistoryRefsResult | null;
  readonly loadMore: () => void;
  /** Silently reloads refs and every loaded page, keeping the current view until it lands. */
  readonly refresh: () => Promise<void>;
  /** Refreshes only when the repository fingerprint moved. */
  readonly checkForChanges: () => Promise<void>;
  /** `failed` when a page could not be read (disconnect, error) before the commit was found. */
  readonly jumpTo: (hash: string) => Promise<"found" | "too-old" | "failed">;
  readonly retry: () => void;
}

/**
 * Async work outlives the render that started it, so it reads and writes this instead of
 * render values. `generation` changes on retry and unmount; work started under an older
 * generation drops its result.
 */
interface GitHistorySession {
  state: GitHistoryState;
  generation: number;
  firstLoad: Promise<void> | null;
  loadingMore: Promise<void> | null;
  refreshing: Promise<void> | null;
  refreshAgain: boolean;
}

const EMPTY_LABELS: ReadonlyMap<string, ReadonlyArray<GitRefLabel>> = new Map();

const failureError = <A, E>(result: AtomCommandResult<A, E>): unknown =>
  AsyncResult.isFailure(result) ? Cause.squash(result.cause) : null;

const isTipsExpired = <A, E>(result: AtomCommandResult<A, E>): boolean => {
  if (!AsyncResult.isFailure(result)) return false;
  const error = Option.getOrNull(Cause.findErrorOption(result.cause));
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "GitHistoryTipsExpiredError"
  );
};

export function useGitHistory(target: GitHistoryTarget): GitHistoryController {
  const { environmentId, projectId, cwd } = target;
  const historyLog = useAtomCommand(gitEnvironment.historyLog, { reportFailure: false });
  const historyFingerprint = useAtomCommand(gitEnvironment.historyFingerprint, {
    reportFailure: false,
  });
  const historyRefs = useAtomCommand(gitEnvironment.historyRefs, { reportFailure: false });
  const [state, setState] = useState(initialGitHistoryState);
  const [refs, setRefs] = useState<GitHistoryRefsResult | null>(null);
  const session = useRef<GitHistorySession>({
    state: initialGitHistoryState,
    generation: 0,
    firstLoad: null,
    loadingMore: null,
    refreshing: null,
    refreshAgain: false,
  });

  const dispatch = (event: GitHistoryEvent) => {
    const next = gitHistoryReducer(session.current.state, event);
    session.current.state = next;
    setState(next);
  };

  const fetchPage = async (request: GitHistoryPageRequest): Promise<GitHistoryLogResult | null> => {
    const result = await historyLog({ environmentId, input: { cwd, ...request } });
    return AsyncResult.isSuccess(result) ? result.value : null;
  };

  const loadFirstPage = (): Promise<void> => {
    const current = session.current;
    const generation = current.generation;
    const run = async () => {
      const [log, refsResult] = await Promise.all([
        historyLog({ environmentId, input: { cwd, offset: 0 } }),
        historyRefs({ environmentId, input: { cwd } }),
      ]);
      if (current.generation !== generation) return;
      current.firstLoad = null;
      if (AsyncResult.isSuccess(log) && AsyncResult.isSuccess(refsResult)) {
        setRefs(refsResult.value);
        dispatch({ type: "firstPage", page: log.value });
        // The two reads raced a repository change, so the labels may not match the graph. This
        // follow-up is the one reconcile round; it does not add another of its own.
        if (refsResult.value.fingerprint !== log.value.fingerprint) void startRefresh(0);
        return;
      }
      dispatch({ type: "failed", error: failureError(log) ?? failureError(refsResult) });
    };
    current.firstLoad = run();
    return current.firstLoad;
  };

  /** Resolves true when refs and log came from different snapshots, so labels may be stale. */
  const reloadOnce = async (generation: number): Promise<boolean> => {
    const current = session.current;
    const refsResult = await historyRefs({ environmentId, input: { cwd } });
    if (!AsyncResult.isSuccess(refsResult) || current.generation !== generation) return false;
    const pages = await reloadHistoryPages(() => current.state.commits.length, fetchPage);
    if (pages === null || current.generation !== generation) return false;
    setRefs(refsResult.value);
    dispatch({ type: "reloaded", pages });
    return refsResult.value.fingerprint !== pages[0]?.fingerprint;
  };

  /**
   * Refs and log are separate reads, and a change between them leaves the labels stale with
   * nothing left to notice it: the stored fingerprint already matches the repository. Up to
   * `reconcileRounds` extra rounds fix that; the cap keeps an agent committing continuously
   * from chaining full reloads, and the next trigger reconciles whatever is still off.
   */
  const startRefresh = (reconcileRounds: number): Promise<void> => {
    const current = session.current;
    if (current.refreshing !== null) {
      // A trigger that lands mid-run may describe a change the run already missed, so the
      // run goes around once more instead of starting a second, overlapping reload.
      current.refreshAgain = true;
      return current.refreshing;
    }
    const generation = current.generation;
    const run = async () => {
      let roundsLeft = reconcileRounds;
      let again = true;
      while (again && current.generation === generation) {
        current.refreshAgain = false;
        const stale = await reloadOnce(generation);
        const reconcile = stale && roundsLeft > 0;
        if (reconcile) roundsLeft -= 1;
        again = current.refreshAgain || reconcile;
      }
      if (current.generation === generation) current.refreshing = null;
    };
    current.refreshing = run();
    return current.refreshing;
  };

  const refresh = () => startRefresh(1);

  const loadMore = (): Promise<void> => {
    const current = session.current;
    if (current.loadingMore !== null) return current.loadingMore;
    if (current.state.status !== "ready" || !current.state.hasMore) return Promise.resolve();
    const generation = current.generation;
    const run = async () => {
      // A page read against the snapshot a running refresh is replacing would be dropped, so
      // wait for it and continue from what it loaded. Awaiting null still defers the body, so
      // `loadingMore` is set before anything below clears it.
      await current.refreshing;
      const loaded = current.state;
      if (current.generation !== generation) return;
      if (loaded.status !== "ready" || !loaded.hasMore) {
        current.loadingMore = null;
        return;
      }
      const result = await historyLog({
        environmentId,
        input: { cwd, tips: loaded.tips, offset: loaded.commits.length },
      });
      if (current.generation !== generation) return;
      current.loadingMore = null;
      if (AsyncResult.isSuccess(result)) {
        dispatch({ type: "nextPage", page: result.value });
      } else if (isTipsExpired(result)) {
        await refresh();
      } else {
        dispatch({ type: "nextPageFailed", error: failureError(result) });
      }
    };
    current.loadingMore = run();
    return current.loadingMore;
  };

  const checkForChanges = async () => {
    const current = session.current;
    // The first load is still reading the snapshot this check would compare against.
    if (current.state.status === "loading") return;
    const generation = current.generation;
    const result = await historyFingerprint({ environmentId, input: { cwd } });
    if (!AsyncResult.isSuccess(result) || current.generation !== generation) return;
    if (result.value.fingerprint === current.state.fingerprint) return;
    await refresh();
  };

  const jumpTo = async (hash: string): Promise<"found" | "too-old" | "failed"> => {
    const current = session.current;
    await current.firstLoad;
    for (;;) {
      const state = current.state;
      if (state.status === "error") return "failed";
      const plan = planJump({ commits: state.commits, targetHash: hash, hasMore: state.hasMore });
      if (plan.kind !== "load-more") return plan.kind;
      await loadMore();
      // An unchanged state means the page was not applied; asking again would loop forever.
      if (current.state.loadMoreError !== null || current.state === state) return "failed";
    }
  };

  const restart = () => {
    const current = session.current;
    current.generation += 1;
    current.firstLoad = null;
    current.loadingMore = null;
    current.refreshing = null;
    current.refreshAgain = false;
  };

  const retry = () => {
    restart();
    setRefs(null);
    dispatch({ type: "retry" });
    void loadFirstPage();
  };

  const stableLoadFirstPage = useStableCallback(loadFirstPage);
  const stableRestart = useStableCallback(restart);
  const stableLoadMore = useStableCallback(() => {
    void loadMore();
  });
  const stableRefresh = useStableCallback(refresh);
  const stableCheckForChanges = useStableCallback(checkForChanges);
  const stableJumpTo = useStableCallback(jumpTo);
  const stableRetry = useStableCallback(retry);

  // Callers mount one hook per target (the Git page keys each tab), so the first load runs once.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the first history fetch on mount and drops in-flight pages on unmount
  useEffect(() => {
    void stableLoadFirstPage();
    return stableRestart;
  }, [stableLoadFirstPage, stableRestart]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to window focus, an external event, to pick up changes made outside the app
  useEffect(() => {
    const listener = () => void stableCheckForChanges();
    window.addEventListener("focus", listener);
    return () => window.removeEventListener("focus", listener);
  }, [stableCheckForChanges]);

  // A turn that ends has usually just written to the repository (commits, checkouts).
  const shells = useQuietThreadShells();
  const turnActivity = new Map<string, boolean>();
  for (const shell of shells) {
    if (shell.environmentId === environmentId && shell.projectId === projectId) {
      turnActivity.set(shell.id, threadRuntimeIsActive(shell.runtime));
    }
  }
  const previousTurnActivity = useRef(turnActivity);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reacts to turns ending in the external thread store, which writes no handler here
  useEffect(() => {
    const ended = endedTurnThreadKeys(previousTurnActivity.current, turnActivity);
    previousTurnActivity.current = turnActivity;
    if (ended.length > 0) void stableCheckForChanges();
  }, [turnActivity, stableCheckForChanges]);

  const connected = useEnvironment(environmentId)?.connection.phase === "connected";
  const wasConnected = useRef(connected);
  const retriedAfterConnect = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retries the first load when the environment connection, an external state, comes up
  useEffect(() => {
    const arrived = !wasConnected.current && connected;
    const retryNow = shouldRetryFirstLoad({
      wasConnected: wasConnected.current,
      connected,
      status: session.current.state.status,
    });
    wasConnected.current = connected;
    if (arrived) retriedAfterConnect.current = retryNow;
    if (retryNow) stableRetry();
  }, [connected, stableRetry]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retries once when a first load fails after the connection was already up
  useEffect(() => {
    const retryNow = shouldRetryLateFailure({
      connected,
      status: state.status,
      error: state.error,
      alreadyRetried: retriedAfterConnect.current,
    });
    if (!retryNow) return;
    retriedAfterConnect.current = true;
    stableRetry();
  }, [connected, state.status, state.error, stableRetry]);

  const layout = computeGraphLayout(state.commits);
  const labels = refs === null ? EMPTY_LABELS : buildRefLabels(refs);

  return {
    state,
    layout,
    labels,
    refs,
    loadMore: stableLoadMore,
    refresh: stableRefresh,
    checkForChanges: stableCheckForChanges,
    jumpTo: stableJumpTo,
    retry: stableRetry,
  };
}
