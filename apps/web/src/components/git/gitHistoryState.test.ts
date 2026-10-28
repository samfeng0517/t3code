import {
  GIT_HISTORY_PAGE_SIZE,
  type GitHistoryLogResult,
  type GitHistoryRefsResult,
  type GitLogCommit,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildRefLabels,
  endedTurnThreadKeys,
  GIT_HISTORY_JUMP_LIMIT,
  gitHistoryReducer,
  type GitHistoryState,
  initialGitHistoryState,
  jumpFeedbackKey,
  nextSelectedHash,
  planJump,
  planRefJump,
  reloadHistoryPages,
  shouldRetryFirstLoad,
  shouldRetryLateFailure,
} from "./gitHistoryState";

const commit = (hash: string): GitLogCommit => ({
  hash,
  parents: [],
  authorName: "Ada",
  authoredAt: 0,
  subject: hash,
});

const page = (overrides: Partial<GitHistoryLogResult> = {}): GitHistoryLogResult => ({
  isRepo: true,
  tips: ["t1"],
  fingerprint: "fp1",
  offset: 0,
  commits: [commit("a"), commit("b")],
  hasMore: true,
  ...overrides,
});

const readyState = (): GitHistoryState =>
  gitHistoryReducer(initialGitHistoryState, { type: "firstPage", page: page() });

describe("gitHistoryReducer", () => {
  it("gitHistoryReducer should append a next page when its offset and tips match the loaded snapshot", () => {
    const next = gitHistoryReducer(readyState(), {
      type: "nextPage",
      page: page({ offset: 2, commits: [commit("c")], hasMore: false }),
    });

    expect(next.commits.map((c) => c.hash)).toEqual(["a", "b", "c"]);
    expect(next.hasMore).toBe(false);
  });

  it("gitHistoryReducer should drop a next page when its tips differ from the loaded snapshot", () => {
    const state = readyState();
    const next = gitHistoryReducer(state, {
      type: "nextPage",
      page: page({ tips: ["t2"], offset: 2, commits: [commit("c")] }),
    });

    expect(next).toBe(state);
  });

  it("gitHistoryReducer should drop a next page when its offset is not the loaded count", () => {
    const state = readyState();
    const next = gitHistoryReducer(state, {
      type: "nextPage",
      page: page({ offset: 1, commits: [commit("b"), commit("c")] }),
    });

    expect(next).toBe(state);
  });

  it("gitHistoryReducer should keep loaded commits when a failure arrives after the first page", () => {
    const state = readyState();
    const next = gitHistoryReducer(state, { type: "failed", error: new Error("disconnected") });

    expect(next).toBe(state);
  });

  it("gitHistoryReducer should report error when a failure arrives while loading", () => {
    const error = new Error("boom");
    const next = gitHistoryReducer(initialGitHistoryState, { type: "failed", error });

    expect(next.status).toBe("error");
    expect(next.error).toBe(error);
  });

  it("gitHistoryReducer should return to loading when retry follows an error", () => {
    const failed = gitHistoryReducer(initialGitHistoryState, {
      type: "failed",
      error: new Error("boom"),
    });

    expect(gitHistoryReducer(failed, { type: "retry" })).toEqual(initialGitHistoryState);
  });

  it("gitHistoryReducer should replace commits without a loading state when reloaded", () => {
    const next = gitHistoryReducer(readyState(), {
      type: "reloaded",
      pages: [
        page({ tips: ["t2"], fingerprint: "fp2", commits: [commit("x"), commit("y")] }),
        page({
          tips: ["t2"],
          fingerprint: "fp2",
          offset: 2,
          commits: [commit("z")],
          hasMore: false,
        }),
      ],
    });

    expect(next).toEqual({
      status: "ready",
      tips: ["t2"],
      fingerprint: "fp2",
      commits: [commit("x"), commit("y"), commit("z")],
      hasMore: false,
      error: null,
      loadMoreError: null,
    });
  });

  it("gitHistoryReducer should record a load-more error when a next page fails while ready", () => {
    const error = new Error("offline");
    const next = gitHistoryReducer(readyState(), { type: "nextPageFailed", error });

    expect(next.status).toBe("ready");
    expect(next.loadMoreError).toBe(error);
    expect(next.commits.map((c) => c.hash)).toEqual(["a", "b"]);
  });

  it("gitHistoryReducer should clear the load-more error when the next page lands", () => {
    const failed = gitHistoryReducer(readyState(), { type: "nextPageFailed", error: "offline" });
    const next = gitHistoryReducer(failed, {
      type: "nextPage",
      page: page({ offset: 2, commits: [commit("c")], hasMore: false }),
    });

    expect(next.loadMoreError).toBeNull();
  });

  it("gitHistoryReducer should ignore a next page failure when not ready", () => {
    const next = gitHistoryReducer(initialGitHistoryState, {
      type: "nextPageFailed",
      error: "offline",
    });

    expect(next).toBe(initialGitHistoryState);
  });

  it("gitHistoryReducer should report empty when the first page has no commits", () => {
    const next = gitHistoryReducer(initialGitHistoryState, {
      type: "firstPage",
      page: page({ commits: [], hasMore: false }),
    });

    expect(next.status).toBe("empty");
  });

  it("gitHistoryReducer should report not-repo when isRepo is false", () => {
    const next = gitHistoryReducer(initialGitHistoryState, {
      type: "firstPage",
      page: page({ isRepo: false, tips: [], fingerprint: null, commits: [], hasMore: false }),
    });

    expect(next.status).toBe("not-repo");
  });
});

describe("planJump", () => {
  it("planJump should report found when the target is loaded", () => {
    expect(
      planJump({ commits: [commit("a"), commit("b")], targetHash: "b", hasMore: true }),
    ).toEqual({ kind: "found", index: 1 });
  });

  it("planJump should ask for more when the target is missing and fewer than 5,000 commits are loaded", () => {
    expect(planJump({ commits: [commit("a")], targetHash: "z", hasMore: true })).toEqual({
      kind: "load-more",
    });
  });

  it("planJump should report too-old when 5,000 commits are loaded", () => {
    const commits = Array.from({ length: GIT_HISTORY_JUMP_LIMIT }, (_, i) => commit(`c${i}`));

    expect(GIT_HISTORY_JUMP_LIMIT).toBe(5000);
    expect(planJump({ commits, targetHash: "z", hasMore: true })).toEqual({ kind: "too-old" });
  });

  it("planJump should report too-old when the history has no more pages", () => {
    expect(planJump({ commits: [commit("a")], targetHash: "z", hasMore: false })).toEqual({
      kind: "too-old",
    });
  });
});

describe("buildRefLabels", () => {
  it("buildRefLabels should put the head branch first and mark only it as head when several refs share a commit", () => {
    const refs: GitHistoryRefsResult = {
      isRepo: true,
      repoRoot: "/repo",
      fingerprint: "fp",
      head: { branch: "main", hash: "h1" },
      branches: [
        { name: "feature", hash: "h1", upstream: null },
        { name: "main", hash: "h1", upstream: "origin/main" },
        { name: "other", hash: "h2", upstream: null },
      ],
      remotes: [
        {
          remote: "origin",
          defaultBranch: "main",
          branches: [{ name: "main", fullName: "origin/main", hash: "h1" }],
        },
      ],
      remoteNames: ["origin"],
      tags: [{ name: "v1", hash: "h1" }],
      stashes: [],
      worktrees: [
        { path: "/wt", name: "wt", hash: "h1", branch: null },
        { path: "/gone", name: "gone", hash: null, branch: null },
      ],
    };

    const labels = buildRefLabels(refs);

    expect(labels.get("h1")).toEqual([
      { kind: "local", name: "main", isHead: true },
      { kind: "local", name: "feature", isHead: false },
      { kind: "remote", name: "origin/main", isHead: false },
      { kind: "tag", name: "v1", isHead: false },
      { kind: "worktree", name: "wt", isHead: false },
    ]);
    expect(labels.get("h2")).toEqual([{ kind: "local", name: "other", isHead: false }]);
  });
});

describe("nextSelectedHash", () => {
  const hashes = ["a", "b", "c"];

  it("nextSelectedHash should move down one row when ArrowDown is pressed", () => {
    expect(nextSelectedHash(hashes, "a", "ArrowDown")).toBe("b");
  });

  it("nextSelectedHash should clamp at the last row when ArrowDown is pressed on it", () => {
    expect(nextSelectedHash(hashes, "c", "ArrowDown")).toBe("c");
  });

  it("nextSelectedHash should clamp at the first row when ArrowUp is pressed on it", () => {
    expect(nextSelectedHash(hashes, "a", "ArrowUp")).toBe("a");
  });

  it("nextSelectedHash should jump to the first row when Home is pressed", () => {
    expect(nextSelectedHash(hashes, "c", "Home")).toBe("a");
  });

  it("nextSelectedHash should jump to the last row when End is pressed", () => {
    expect(nextSelectedHash(hashes, "a", "End")).toBe("c");
  });

  it("nextSelectedHash should select the first row when the current hash is not loaded", () => {
    expect(nextSelectedHash(hashes, null, "ArrowDown")).toBe("a");
    expect(nextSelectedHash(hashes, "zzz", "End")).toBe("a");
  });

  it("nextSelectedHash should return null when there are no rows", () => {
    expect(nextSelectedHash([], null, "Home")).toBeNull();
  });
});

describe("endedTurnThreadKeys", () => {
  it("endedTurnThreadKeys should return threads whose turn was active and no longer is", () => {
    const previous = new Map([
      ["ended", true],
      ["removed", true],
      ["still", true],
      ["idle", false],
    ]);
    const next = new Map([
      ["ended", false],
      ["still", true],
      ["idle", false],
      ["started", true],
    ]);

    expect(endedTurnThreadKeys(previous, next)).toEqual(["ended", "removed"]);
  });
});

describe("shouldRetryFirstLoad", () => {
  it("shouldRetryFirstLoad should retry when the connection arrives after the first load failed", () => {
    expect(shouldRetryFirstLoad({ wasConnected: false, connected: true, status: "error" })).toBe(
      true,
    );
  });

  it("shouldRetryFirstLoad should not retry when the connection did not just arrive or nothing failed", () => {
    expect(shouldRetryFirstLoad({ wasConnected: true, connected: true, status: "error" })).toBe(
      false,
    );
    expect(shouldRetryFirstLoad({ wasConnected: false, connected: false, status: "error" })).toBe(
      false,
    );
    expect(shouldRetryFirstLoad({ wasConnected: false, connected: true, status: "ready" })).toBe(
      false,
    );
  });
});

describe("shouldRetryLateFailure", () => {
  const unavailable = { _tag: "EnvironmentRpcUnavailableError" };

  it("shouldRetryLateFailure should retry once when a not-connected failure lands after the connection arrived", () => {
    const input = { connected: true, status: "error", error: unavailable } as const;
    expect(shouldRetryLateFailure({ ...input, alreadyRetried: false })).toBe(true);
    expect(shouldRetryLateFailure({ ...input, alreadyRetried: true })).toBe(false);
  });

  it("shouldRetryLateFailure should not retry when the failure is another error or the connection is down", () => {
    expect(
      shouldRetryLateFailure({
        connected: true,
        status: "error",
        error: new Error("boom"),
        alreadyRetried: false,
      }),
    ).toBe(false);
    expect(
      shouldRetryLateFailure({
        connected: false,
        status: "error",
        error: unavailable,
        alreadyRetried: false,
      }),
    ).toBe(false);
  });
});

describe("reloadHistoryPages", () => {
  const fullPage = (offset: number, tips: ReadonlyArray<string>, hasMore = true) =>
    page({
      tips,
      offset,
      commits: Array.from({ length: GIT_HISTORY_PAGE_SIZE }, (_, i) =>
        commit(`${tips[0]}-${offset + i}`),
      ),
      hasMore,
    });

  it("reloadHistoryPages should request every later page with the first page's tips when a commit lands mid-refresh", async () => {
    const requests: Array<{ readonly tips?: ReadonlyArray<string>; readonly offset: number }> = [];
    // The repository moves to tip "t2" after the first page is read; any page asked without
    // tips would come from the new snapshot and duplicate or skip commits.
    const fetchPage = async (request: {
      readonly tips?: ReadonlyArray<string>;
      readonly offset: number;
    }) => {
      requests.push(request);
      return fullPage(request.offset, request.tips ?? (requests.length === 1 ? ["t1"] : ["t2"]));
    };

    const pages = await reloadHistoryPages(() => GIT_HISTORY_PAGE_SIZE * 2 + 1, fetchPage);

    expect(requests).toEqual([
      { offset: 0 },
      { tips: ["t1"], offset: GIT_HISTORY_PAGE_SIZE },
      { tips: ["t1"], offset: GIT_HISTORY_PAGE_SIZE * 2 },
    ]);
    const reloaded = gitHistoryReducer(initialGitHistoryState, {
      type: "reloaded",
      pages: pages ?? [],
    });
    const hashes = reloaded.commits.map((c) => c.hash);
    expect(new Set(hashes).size).toBe(GIT_HISTORY_PAGE_SIZE * 3);
    expect(hashes.every((hash) => hash.startsWith("t1-"))).toBe(true);
  });

  it("reloadHistoryPages should read one page when nothing is loaded yet", async () => {
    const offsets: number[] = [];
    const pages = await reloadHistoryPages(
      () => 0,
      async (request) => {
        offsets.push(request.offset);
        return fullPage(request.offset, ["t1"]);
      },
    );

    expect(offsets).toEqual([0]);
    expect(pages).toHaveLength(1);
  });

  it("reloadHistoryPages should stop early when a page reports no more history", async () => {
    const offsets: number[] = [];
    const pages = await reloadHistoryPages(
      () => GIT_HISTORY_PAGE_SIZE * 3,
      async (request) => {
        offsets.push(request.offset);
        return fullPage(request.offset, ["t1"], false);
      },
    );

    expect(offsets).toEqual([0]);
    expect(pages).toHaveLength(1);
  });

  it("reloadHistoryPages should cover pages loaded while the reload is running when the loaded count grows", async () => {
    let loaded = GIT_HISTORY_PAGE_SIZE;
    const offsets: number[] = [];
    const pages = await reloadHistoryPages(
      () => loaded,
      async (request) => {
        offsets.push(request.offset);
        // A load-more lands while the first reloaded page is in flight.
        if (request.offset === 0) loaded = GIT_HISTORY_PAGE_SIZE * 2;
        return fullPage(request.offset, ["t1"]);
      },
    );

    expect(offsets).toEqual([0, GIT_HISTORY_PAGE_SIZE]);
    expect(pages).toHaveLength(2);
  });

  it("reloadHistoryPages should return null when any page fails", async () => {
    const pages = await reloadHistoryPages(
      () => GIT_HISTORY_PAGE_SIZE + 1,
      async (request) => (request.offset === 0 ? fullPage(0, ["t1"]) : null),
    );

    expect(pages).toBeNull();
  });
});

describe("planRefJump", () => {
  const stashes = [
    { index: 0, ref: "stash@{0}", message: "WIP on main", hash: "s1", baseHash: "b1" },
  ];

  it("planRefJump should select the ref once the jump finds it when the ref is not a stash", () => {
    expect(planRefJump(stashes, "h1", { select: true })).toEqual({
      selectNow: null,
      scrollHash: "h1",
      selectOnFound: "h1",
    });
  });

  it("planRefJump should select the stash at once and scroll to its base when a stash is clicked", () => {
    expect(planRefJump(stashes, "s1", { select: false })).toEqual({
      selectNow: "s1",
      scrollHash: "b1",
      selectOnFound: null,
    });
  });

  it("planRefJump should return null when the clicked stash is no longer in the refs", () => {
    expect(planRefJump([], "s1", { select: false })).toBeNull();
  });
});

describe("jumpFeedbackKey", () => {
  it("jumpFeedbackKey should name the load failure copy when the jump failed", () => {
    expect(jumpFeedbackKey("failed")).toBe("git.history.loadFailed");
  });

  it("jumpFeedbackKey should name the jump cap copy when the commit is too old", () => {
    expect(jumpFeedbackKey("too-old")).toBe("git.history.jumpTooOld");
  });

  it("jumpFeedbackKey should return null when the commit was found", () => {
    expect(jumpFeedbackKey("found")).toBeNull();
  });
});
