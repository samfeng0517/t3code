import {
  GIT_HISTORY_PAGE_SIZE,
  type GitHistoryLogResult,
  type GitHistoryRefsResult,
  type GitHistoryStash,
  type GitLogCommit,
} from "@t3tools/contracts";

/** Jumping to a commit pages in history only until this many commits are loaded. */
export const GIT_HISTORY_JUMP_LIMIT = 5000;

/** Abbreviated hash length shown across the Git page. */
export const SHORT_HASH_LENGTH = 7;

export interface GitHistoryState {
  readonly status: "loading" | "ready" | "empty" | "not-repo" | "error";
  readonly tips: ReadonlyArray<string>;
  readonly fingerprint: string | null;
  readonly commits: ReadonlyArray<GitLogCommit>;
  readonly hasMore: boolean;
  readonly error: unknown;
  /** Why the latest page past the loaded list failed; cleared when a page lands. */
  readonly loadMoreError: unknown;
}

export const initialGitHistoryState: GitHistoryState = {
  status: "loading",
  tips: [],
  fingerprint: null,
  commits: [],
  hasMore: false,
  error: null,
  loadMoreError: null,
};

export type GitHistoryEvent =
  | { readonly type: "firstPage"; readonly page: GitHistoryLogResult }
  | { readonly type: "nextPage"; readonly page: GitHistoryLogResult }
  | { readonly type: "reloaded"; readonly pages: ReadonlyArray<GitHistoryLogResult> }
  | { readonly type: "nextPageFailed"; readonly error: unknown }
  | { readonly type: "failed"; readonly error: unknown }
  | { readonly type: "retry" };

const sameTips = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((tip, index) => tip === b[index]);

const stateFromPages = (pages: ReadonlyArray<GitHistoryLogResult>): GitHistoryState => {
  const first = pages[0];
  const last = pages.at(-1);
  if (!first || !last || !first.isRepo) {
    return { ...initialGitHistoryState, status: "not-repo" };
  }
  const commits = pages.flatMap((page) => page.commits);
  return {
    status: commits.length === 0 ? "empty" : "ready",
    tips: first.tips,
    fingerprint: first.fingerprint,
    commits,
    hasMore: last.hasMore,
    error: null,
    loadMoreError: null,
  };
};

export function gitHistoryReducer(state: GitHistoryState, event: GitHistoryEvent): GitHistoryState {
  switch (event.type) {
    case "firstPage":
      return stateFromPages([event.page]);
    case "nextPage": {
      const { page } = event;
      // Only the page that continues the loaded snapshot exactly is applied, so
      // a stale or out-of-order response can never duplicate or skip commits.
      if (
        state.status !== "ready" ||
        page.offset !== state.commits.length ||
        !sameTips(page.tips, state.tips)
      ) {
        return state;
      }
      return {
        ...state,
        commits: [...state.commits, ...page.commits],
        hasMore: page.hasMore,
        loadMoreError: null,
      };
    }
    case "nextPageFailed":
      return state.status === "ready" ? { ...state, loadMoreError: event.error } : state;
    case "reloaded":
      return event.pages.length === 0 ? state : stateFromPages(event.pages);
    case "failed":
      // Loaded content stays visible when a later request fails (disconnect, silent refresh).
      return state.status === "loading" ? { ...state, status: "error", error: event.error } : state;
    case "retry":
      return initialGitHistoryState;
  }
}

export interface GitHistoryPageRequest {
  /** Omitted for the first page so the server takes a fresh snapshot. */
  readonly tips?: ReadonlyArray<string>;
  readonly offset: number;
}

/**
 * `loadedCount` is re-read before every page so a page loaded mid-reload is still covered.
 * Later pages reuse the first page's tips: pages are concatenated blindly, so a commit landing
 * mid-refresh must not shift them. Resolves to null when any page fails.
 */
export async function reloadHistoryPages(
  loadedCount: () => number,
  fetchPage: (request: GitHistoryPageRequest) => Promise<GitHistoryLogResult | null>,
): Promise<ReadonlyArray<GitHistoryLogResult> | null> {
  const pageCount = () => Math.ceil(Math.max(loadedCount(), 1) / GIT_HISTORY_PAGE_SIZE);
  const first = await fetchPage({ offset: 0 });
  if (first === null) return null;
  const pages = [first];
  let last = first;
  let offset = first.commits.length;
  while (pages.length < pageCount() && last.hasMore) {
    const page = await fetchPage({ tips: first.tips, offset });
    if (page === null) return null;
    pages.push(page);
    last = page;
    offset += page.commits.length;
  }
  return pages;
}

export type GitJumpPlan =
  | { readonly kind: "found"; readonly index: number }
  | { readonly kind: "load-more" }
  | { readonly kind: "too-old" };

export function planJump(input: {
  readonly commits: ReadonlyArray<GitLogCommit>;
  readonly targetHash: string;
  readonly hasMore: boolean;
}): GitJumpPlan {
  const index = input.commits.findIndex((commit) => commit.hash === input.targetHash);
  if (index !== -1) return { kind: "found", index };
  if (input.hasMore && input.commits.length < GIT_HISTORY_JUMP_LIMIT) return { kind: "load-more" };
  return { kind: "too-old" };
}

interface GitRefJump {
  /** Selected before the jump starts: a stash shows in the detail without a graph row. */
  readonly selectNow: string | null;
  readonly scrollHash: string;
  /** Selected once the jump finds `scrollHash`. */
  readonly selectOnFound: string | null;
}

/**
 * Null when the clicked stash is gone (a refresh dropped it): its own commit is never in the
 * graph, so jumping to it would page in history up to the jump limit for nothing.
 */
export function planRefJump(
  stashes: ReadonlyArray<GitHistoryStash>,
  hash: string,
  opts: { readonly select: boolean },
): GitRefJump | null {
  if (opts.select) return { selectNow: null, scrollHash: hash, selectOnFound: hash };
  const stash = stashes.find((entry) => entry.hash === hash);
  return stash ? { selectNow: stash.hash, scrollHash: stash.baseHash, selectOnFound: null } : null;
}

export function jumpFeedbackKey(
  result: "found" | "too-old" | "failed",
): "git.history.jumpTooOld" | "git.history.loadFailed" | null {
  if (result === "too-old") return "git.history.jumpTooOld";
  if (result === "failed") return "git.history.loadFailed";
  return null;
}

export interface GitRefLabel {
  readonly kind: "local" | "remote" | "tag" | "worktree";
  readonly name: string;
  readonly isHead: boolean;
}

export function buildRefLabels(
  refs: GitHistoryRefsResult,
): ReadonlyMap<string, ReadonlyArray<GitRefLabel>> {
  const labels = new Map<string, GitRefLabel[]>();
  const add = (hash: string, label: GitRefLabel) => {
    const existing = labels.get(hash);
    if (existing) existing.push(label);
    else labels.set(hash, [label]);
  };

  const headBranch = refs.head.branch;
  const head = refs.branches.find((branch) => branch.name === headBranch);
  if (head) add(head.hash, { kind: "local", name: head.name, isHead: true });
  for (const branch of refs.branches) {
    if (branch !== head) add(branch.hash, { kind: "local", name: branch.name, isHead: false });
  }
  for (const remote of refs.remotes) {
    for (const branch of remote.branches) {
      add(branch.hash, { kind: "remote", name: branch.fullName, isHead: false });
    }
  }
  for (const tag of refs.tags) {
    add(tag.hash, { kind: "tag", name: tag.name, isHead: false });
  }
  for (const worktree of refs.worktrees) {
    if (worktree.hash) add(worktree.hash, { kind: "worktree", name: worktree.name, isHead: false });
  }
  return labels;
}

export function nextSelectedHash(
  hashes: ReadonlyArray<string>,
  current: string | null,
  key: "ArrowUp" | "ArrowDown" | "Home" | "End",
): string | null {
  if (hashes.length === 0) return null;
  const index = current === null ? -1 : hashes.indexOf(current);
  if (index === -1) return hashes[0] ?? null;
  const lastIndex = hashes.length - 1;
  const nextIndex =
    key === "Home"
      ? 0
      : key === "End"
        ? lastIndex
        : key === "ArrowUp"
          ? Math.max(0, index - 1)
          : Math.min(lastIndex, index + 1);
  return hashes[nextIndex] ?? null;
}

/**
 * A page opened from a reload asks before the environment socket is up, so the first read
 * fails with "not connected". Once the connection arrives, that failure is stale.
 */
export function shouldRetryFirstLoad(input: {
  readonly wasConnected: boolean;
  readonly connected: boolean;
  readonly status: GitHistoryState["status"];
}): boolean {
  return !input.wasConnected && input.connected && input.status === "error";
}

/**
 * The failed read can also land after the connection arrived: the rejection is only
 * dispatched once the promise settles, which may be after the render that saw `connected`.
 * That failure is just as stale, but only a not-connected error is, and only once.
 */
export function shouldRetryLateFailure(input: {
  readonly connected: boolean;
  readonly status: GitHistoryState["status"];
  readonly error: unknown;
  readonly alreadyRetried: boolean;
}): boolean {
  return (
    input.connected &&
    input.status === "error" &&
    !input.alreadyRetried &&
    typeof input.error === "object" &&
    input.error !== null &&
    "_tag" in input.error &&
    input.error._tag === "EnvironmentRpcUnavailableError"
  );
}

/** Keys whose turn was running in `previous` and is no longer running in `next`. */
export function endedTurnThreadKeys(
  previous: ReadonlyMap<string, boolean>,
  next: ReadonlyMap<string, boolean>,
): ReadonlyArray<string> {
  const ended: string[] = [];
  for (const [key, active] of previous) {
    if (active && next.get(key) !== true) ended.push(key);
  }
  return ended;
}
