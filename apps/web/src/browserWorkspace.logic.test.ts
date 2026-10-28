import type { EnvironmentId, PreviewSessionSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type BrowserWorkspaceTab,
  browserWorkspaceThreadRef,
  dormantBrowserWorkspaceSnapshot,
  insertBrowserWorkspaceTab,
  isBrowserWorkspaceThreadRef,
  moveBrowserWorkspaceTab,
  planBrowserWorkspaceSessions,
  removeBrowserWorkspaceTab,
  renameBrowserWorkspaceTab,
  resolveBrowserWorkspaceEnvironmentId,
  sanitizePersistedBrowserWorkspaceTabs,
  setBrowserWorkspaceTabPinned,
} from "./browserWorkspace.logic";

const tab = (id: string, overrides: Partial<BrowserWorkspaceTab> = {}): BrowserWorkspaceTab => ({
  id,
  url: `https://${id}.example/`,
  title: id,
  pinned: false,
  sessionTabId: null,
  ...overrides,
});

const ids = (tabs: ReadonlyArray<BrowserWorkspaceTab>) => tabs.map((entry) => entry.id);

const session = (
  tabId: string,
  navStatus: PreviewSessionSnapshot["navStatus"] = {
    _tag: "Success",
    url: `https://${tabId}.example/`,
    title: tabId,
  },
  profileId?: string,
): PreviewSessionSnapshot => ({
  threadId: "browser-workspace-client",
  tabId,
  navStatus,
  canGoBack: false,
  canGoForward: false,
  ...(profileId === undefined ? {} : { profileId }),
  updatedAt: "2026-10-22T00:00:00.000Z",
});

const primary = "primary" as EnvironmentId;
const remote = "remote" as EnvironmentId;

describe("browserWorkspaceThreadRef", () => {
  it("should be recognised as a workspace ref when built for any environment", () => {
    const ref = browserWorkspaceThreadRef(primary, "client-1");
    expect(ref.environmentId).toBe(primary);
    expect(isBrowserWorkspaceThreadRef(ref)).toBe(true);
    expect(
      isBrowserWorkspaceThreadRef({ ...ref, threadId: "thread-1" as typeof ref.threadId }),
    ).toBe(false);
  });
});

describe("resolveBrowserWorkspaceEnvironmentId", () => {
  it("should use the primary environment when the desktop renders tabs itself", () => {
    expect(
      resolveBrowserWorkspaceEnvironmentId({
        primaryEnvironmentId: primary,
        environmentIds: [remote, primary],
        previewInRuntime: true,
        supportsServerBrowser: () => false,
      }),
    ).toBe(primary);
  });

  it("should fall back to the first environment with a server browser when the primary has none", () => {
    expect(
      resolveBrowserWorkspaceEnvironmentId({
        primaryEnvironmentId: primary,
        environmentIds: [primary, remote],
        previewInRuntime: false,
        supportsServerBrowser: (id) => id === remote,
      }),
    ).toBe(remote);
  });

  it("should return null when no environment can run browser tabs", () => {
    expect(
      resolveBrowserWorkspaceEnvironmentId({
        primaryEnvironmentId: null,
        environmentIds: [remote],
        previewInRuntime: false,
        supportsServerBrowser: () => false,
      }),
    ).toBeNull();
  });
});

describe("insertBrowserWorkspaceTab", () => {
  it("should append a new tab after every other tab when no opener is given", () => {
    const tabs = [tab("pinned", { pinned: true }), tab("a")];
    expect(ids(insertBrowserWorkspaceTab(tabs, tab("new")))).toEqual(["pinned", "a", "new"]);
  });

  it("should place a tab right after its opener when the opener is unpinned", () => {
    const tabs = [tab("a"), tab("b")];
    expect(ids(insertBrowserWorkspaceTab(tabs, tab("new"), "a"))).toEqual(["a", "new", "b"]);
  });

  it("should place a tab first among unpinned tabs when its opener is pinned", () => {
    const tabs = [tab("p1", { pinned: true }), tab("p2", { pinned: true }), tab("a")];
    expect(ids(insertBrowserWorkspaceTab(tabs, tab("new"), "p1"))).toEqual([
      "p1",
      "p2",
      "new",
      "a",
    ]);
  });
});

describe("removeBrowserWorkspaceTab", () => {
  it("should select the right neighbour when the active tab closes", () => {
    const result = removeBrowserWorkspaceTab(
      { tabs: [tab("a"), tab("b"), tab("c")], activeTabId: "b" },
      "b",
    );
    expect(ids(result.tabs)).toEqual(["a", "c"]);
    expect(result.activeTabId).toBe("c");
  });

  it("should select the left neighbour when the last active tab closes", () => {
    const result = removeBrowserWorkspaceTab({ tabs: [tab("a"), tab("b")], activeTabId: "b" }, "b");
    expect(result.activeTabId).toBe("a");
  });

  it("should keep the selection when an inactive tab closes", () => {
    const result = removeBrowserWorkspaceTab({ tabs: [tab("a"), tab("b")], activeTabId: "a" }, "b");
    expect(result.activeTabId).toBe("a");
  });

  it("should select nothing when the only tab closes", () => {
    expect(removeBrowserWorkspaceTab({ tabs: [tab("a")], activeTabId: "a" }, "a")).toEqual({
      tabs: [],
      activeTabId: null,
    });
  });
});

describe("setBrowserWorkspaceTabPinned", () => {
  it("should move a pinned tab to the end of the pinned group when it is pinned", () => {
    const tabs = [tab("p", { pinned: true }), tab("a"), tab("b")];
    const result = setBrowserWorkspaceTabPinned(tabs, "b", true);
    expect(ids(result)).toEqual(["p", "b", "a"]);
    expect(result[1]?.pinned).toBe(true);
  });

  it("should move a tab to the start of the unpinned group when it is unpinned", () => {
    const tabs = [tab("p1", { pinned: true }), tab("p2", { pinned: true }), tab("a")];
    const result = setBrowserWorkspaceTabPinned(tabs, "p1", false);
    expect(ids(result)).toEqual(["p2", "p1", "a"]);
    expect(result[1]?.pinned).toBe(false);
  });
});

describe("renameBrowserWorkspaceTab", () => {
  it("should store the trimmed name on that tab only when a tab is renamed", () => {
    const result = renameBrowserWorkspaceTab([tab("a"), tab("b")], "a", "  Inbox ");
    expect(result.map((entry) => entry.customTitle)).toEqual(["Inbox", undefined]);
  });

  it("should drop the custom name when the new name is blank", () => {
    const result = renameBrowserWorkspaceTab([tab("a", { customTitle: "Inbox" })], "a", "   ");
    expect(result[0]).toEqual(tab("a"));
  });

  it("should keep every tab object when the name does not change", () => {
    const tabs = [tab("a", { customTitle: "Inbox" }), tab("b")];
    const result = renameBrowserWorkspaceTab(tabs, "a", "Inbox");
    expect(result.every((entry, index) => entry === tabs[index])).toBe(true);
  });
});

describe("moveBrowserWorkspaceTab", () => {
  const tabs = [
    tab("p1", { pinned: true }),
    tab("p2", { pinned: true }),
    tab("a"),
    tab("b"),
    tab("c"),
  ];

  it("should land the dragged tab on the drop target when both share a group", () => {
    expect(ids(moveBrowserWorkspaceTab(tabs, "c", "a") ?? [])).toEqual(["p1", "p2", "c", "a", "b"]);
    expect(ids(moveBrowserWorkspaceTab(tabs, "p1", "p2") ?? [])).toEqual([
      "p2",
      "p1",
      "a",
      "b",
      "c",
    ]);
  });

  it("should refuse the move when the drop crosses the pinned boundary", () => {
    expect(moveBrowserWorkspaceTab(tabs, "a", "p2")).toBeNull();
    expect(moveBrowserWorkspaceTab(tabs, "p2", "a")).toBeNull();
  });

  it("should refuse the move when a tab is dropped on itself or on a closed tab", () => {
    expect(moveBrowserWorkspaceTab(tabs, "a", "a")).toBeNull();
    expect(moveBrowserWorkspaceTab(tabs, "a", "gone")).toBeNull();
  });
});

describe("planBrowserWorkspaceSessions", () => {
  const plan = (input: {
    readonly tabs: ReadonlyArray<BrowserWorkspaceTab>;
    readonly sessions: ReadonlyArray<PreviewSessionSnapshot>;
    readonly activeTabId?: string | null;
    readonly activeSessionTabId?: string | null;
  }) =>
    planBrowserWorkspaceSessions({
      tabs: input.tabs,
      activeTabId: input.activeTabId ?? null,
      sessions: Object.fromEntries(input.sessions.map((entry) => [entry.tabId, entry])),
      activeSessionTabId: input.activeSessionTabId ?? null,
    });

  it("should reattach a live session to the stored tab with the same url when the app reloads", () => {
    const result = plan({
      tabs: [tab("a", { url: "https://a.example/" }), tab("b", { url: "https://b.example/" })],
      sessions: [
        session("s-b", { _tag: "Success", url: "https://b.example/", title: "b" }),
        session("s-a", { _tag: "Success", url: "https://a.example/", title: "a" }),
      ],
    });
    expect(result.reattach).toEqual([
      { tabId: "b", sessionTabId: "s-b" },
      { tabId: "a", sessionTabId: "s-a" },
    ]);
    expect(result.adoptSessions).toEqual([]);
  });

  it("should give the server's active session to the active stored tab when several tabs share its url", () => {
    const url = "https://same.example/";
    const result = plan({
      tabs: [tab("a", { url }), tab("b", { url })],
      activeTabId: "b",
      sessions: [session("s-1", { _tag: "Success", url, title: "x" })],
      activeSessionTabId: "s-1",
    });
    expect(result.reattach).toEqual([{ tabId: "b", sessionTabId: "s-1" }]);
  });

  it("should give the server's active session to the active stored tab when no stored url matches", () => {
    const result = plan({
      tabs: [tab("a"), tab("b")],
      activeTabId: "a",
      sessions: [
        session("s-moved", { _tag: "Success", url: "https://moved.example/", title: "Moved" }),
      ],
      activeSessionTabId: "s-moved",
    });
    expect(result.reattach).toEqual([{ tabId: "a", sessionTabId: "s-moved" }]);
    expect(result.updates).toEqual([
      { tabId: "a", url: "https://moved.example/", title: "Moved", profileId: undefined },
    ]);
  });

  it("should adopt a session and leave dormant tabs alone when no stored tab matches it", () => {
    const popup = session("popup");
    const result = plan({
      tabs: [tab("a", { sessionTabId: "s-a" }), tab("dormant")],
      activeTabId: "a",
      sessions: [session("s-a"), popup],
      activeSessionTabId: "popup",
    });
    expect(result.reattach).toEqual([]);
    expect(result.adoptSessions).toEqual([popup]);
  });

  it("should detach a tab when its session is gone", () => {
    const result = plan({ tabs: [tab("a", { sessionTabId: "gone" }), tab("b")], sessions: [] });
    expect(result.detachTabIds).toEqual(["a"]);
  });

  it("should record the page's url, title and profile when the live session moved on", () => {
    const result = plan({
      tabs: [tab("a", { sessionTabId: "s-a", url: null, title: null })],
      sessions: [
        session(
          "s-a",
          { _tag: "Success", url: "https://docs.example/", title: "  Docs  " },
          "work",
        ),
      ],
    });
    expect(result.updates).toEqual([
      { tabId: "a", url: "https://docs.example/", title: "Docs", profileId: "work" },
    ]);
  });

  it("should report no updates when the persisted tab already matches its session", () => {
    const result = plan({
      tabs: [tab("a", { sessionTabId: "s-a", url: "https://s-a.example/", title: "s-a" })],
      sessions: [session("s-a")],
    });
    expect(result.updates).toEqual([]);
  });
});

describe("dormantBrowserWorkspaceSnapshot", () => {
  it("should carry the tab's url, title and profile when the tab never loaded", () => {
    expect(
      dormantBrowserWorkspaceSnapshot(
        tab("a", { profileId: "work" }),
        "browser-workspace-client",
        "2026-10-22T00:00:00.000Z",
      ),
    ).toMatchObject({
      tabId: "a",
      navStatus: { _tag: "Success", url: "https://a.example/", title: "a" },
      profileId: "work",
    });
  });

  it("should describe a blank tab as idle when the tab has no url", () => {
    expect(
      dormantBrowserWorkspaceSnapshot(tab("a", { url: null }), "t", "2026-10-22T00:00:00.000Z")
        .navStatus,
    ).toEqual({ _tag: "Idle" });
  });
});

describe("sanitizePersistedBrowserWorkspaceTabs", () => {
  it("should drop malformed and duplicate tabs and clear sessions when restoring from storage", () => {
    expect(
      sanitizePersistedBrowserWorkspaceTabs([
        { id: "a", url: "https://a.example/", title: "A", pinned: false, sessionTabId: "s" },
        { id: "a", url: "https://dup.example/" },
        { url: "https://no-id.example/" },
        "junk",
        { id: "p", url: null, title: null, pinned: true, profileId: "work", customTitle: "Mail" },
      ]),
    ).toEqual([
      {
        id: "p",
        url: null,
        title: null,
        pinned: true,
        customTitle: "Mail",
        profileId: "work",
        sessionTabId: null,
      },
      { id: "a", url: "https://a.example/", title: "A", pinned: false, sessionTabId: null },
    ]);
  });

  it("should return no tabs when storage holds something other than a list", () => {
    expect(sanitizePersistedBrowserWorkspaceTabs({ id: "a" })).toEqual([]);
  });
});
