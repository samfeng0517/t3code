import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { BrowserWorkspaceTab } from "~/browserWorkspace.logic";
import type { ClosedView, ClosedViewEntry } from "~/closedViewStore";
import type { DesktopPreviewOverlay } from "~/previewStateStore";

import { deriveSidebarBrowserTabs, recentlyClosedBrowserTabs } from "./sidebarBrowserTabs.logic";

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

const snapshot = (
  tabId: string,
  navStatus: PreviewSessionSnapshot["navStatus"],
): PreviewSessionSnapshot => ({
  threadId: threadRef.threadId,
  tabId,
  navStatus,
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-06-18T19:00:00.000Z",
});

const overlay = (pageUrl: string): DesktopPreviewOverlay => ({
  hasWebContents: true,
  webContentsId: 1,
  canGoBack: false,
  canGoForward: false,
  loading: false,
  zoomFactor: 1,
  pictureInPicture: false,
  colorScheme: "system",
  audioMuted: false,
  audible: false,
  controller: "none",
  favicon: { dataUrl: "data:image/png;base64,AA==", pageUrl, capturedAt: 1 },
});

const tab = (id: string, overrides: Partial<BrowserWorkspaceTab> = {}): BrowserWorkspaceTab => ({
  id,
  url: null,
  title: null,
  pinned: false,
  sessionTabId: null,
  ...overrides,
});

const sessions = {
  titled: snapshot("titled", { _tag: "Success", url: "https://example.com/a", title: " Docs " }),
  untitled: snapshot("untitled", { _tag: "Success", url: "http://localhost:5173/x", title: "" }),
};

const tabs = [
  tab("live", { sessionTabId: "titled", url: "https://stale.example/", title: "Stale" }),
  tab("live-untitled", { sessionTabId: "untitled" }),
  tab("dormant", { url: "https://saved.example/page", title: "Saved page" }),
  tab("dormant-untitled", { url: "https://saved.example/other" }),
  tab("blank"),
];

describe("deriveSidebarBrowserTabs", () => {
  it("should describe live tabs by their page and dormant tabs by what they last showed when listing the workspace", () => {
    const rows = deriveSidebarBrowserTabs({
      tabs,
      activeTabId: "live-untitled",
      workspaceShown: true,
      sessions,
      desktopByTabId: {},
    });

    expect(rows.map((row) => [row.tab.id, row.title, row.url, row.active])).toEqual([
      ["live", "Docs", "https://example.com/a", false],
      ["live-untitled", "localhost:5173", "http://localhost:5173/x", true],
      ["dormant", "Saved page", "https://saved.example/page", false],
      ["dormant-untitled", "saved.example", "https://saved.example/other", false],
      ["blank", null, null, false],
    ]);
  });

  it("should show the tab's custom name instead of its page title when the tab was renamed", () => {
    const rows = deriveSidebarBrowserTabs({
      tabs: [tab("live", { sessionTabId: "titled", customTitle: "Team docs" })],
      activeTabId: null,
      workspaceShown: true,
      sessions,
      desktopByTabId: {},
    });
    expect(rows[0]?.title).toBe("Team docs");
  });

  it("should highlight no tab when the workspace page is not showing", () => {
    const rows = deriveSidebarBrowserTabs({
      tabs,
      activeTabId: "live",
      workspaceShown: false,
      sessions,
      desktopByTabId: {},
    });
    expect(rows.some((row) => row.active)).toBe(false);
  });

  it("should use a captured favicon only when it still belongs to the page's origin", () => {
    const rows = deriveSidebarBrowserTabs({
      tabs,
      activeTabId: null,
      workspaceShown: true,
      sessions,
      desktopByTabId: {
        titled: overlay("https://example.com/b"),
        untitled: overlay("https://elsewhere.dev/"),
      },
    });
    expect(rows[0]?.capturedFaviconUrl).toBe("data:image/png;base64,AA==");
    expect(rows[1]?.capturedFaviconUrl).toBeNull();
  });
});

describe("recentlyClosedBrowserTabs", () => {
  const entry = (id: string, view: ClosedView, closedAt?: number): ClosedViewEntry => ({
    ...view,
    id,
    ...(closedAt === undefined ? {} : { closedAt }),
  });

  it("should list title, host and close time when browser tabs closed in the workspace or any thread", () => {
    const otherThreadRef = { ...threadRef, threadId: "thread-2" as ScopedThreadRef["threadId"] };
    const entries: ClosedViewEntry[] = [
      entry("browser", { kind: "browser", threadRef, snapshot: sessions.titled }, 2_000),
      entry("diff", { kind: "panel-tab", threadRef, surface: { id: "diff", kind: "diff" } }),
      entry("other", { kind: "browser", threadRef: otherThreadRef, snapshot: sessions.untitled }),
    ];

    expect(
      recentlyClosedBrowserTabs(entries).map((row) => [
        row.entry.id,
        row.title,
        row.host,
        row.closedAt,
      ]),
    ).toEqual([
      ["browser", "Docs", "example.com", 2_000],
      ["other", "localhost:5173", "localhost:5173", null],
    ]);
  });

  it("should give a closed blank tab no title or host when it never loaded a page", () => {
    const blank = entry("blank", {
      kind: "browser",
      threadRef,
      snapshot: snapshot("blank", { _tag: "Idle" }),
    });
    expect(recentlyClosedBrowserTabs([blank])).toMatchObject([
      { title: null, host: null, url: null },
    ]);
  });
});
