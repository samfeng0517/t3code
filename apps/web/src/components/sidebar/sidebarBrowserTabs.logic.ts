import type { PreviewSessionSnapshot } from "@t3tools/contracts";

import type { BrowserWorkspaceTab } from "~/browserWorkspace.logic";
import type { ClosedViewEntry } from "~/closedViewStore";
import type { DesktopPreviewOverlay } from "~/previewStateStore";

export interface SidebarBrowserTab {
  readonly tab: BrowserWorkspaceTab;
  /** `null` for a tab with nothing loaded yet; the row shows the blank-tab label. */
  readonly title: string | null;
  readonly url: string | null;
  /** The favicon the desktop captured from the page, when it still matches the page's origin. */
  readonly capturedFaviconUrl: string | null;
  readonly active: boolean;
}

const sameOrigin = (left: string, right: string): boolean => {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
};

export const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
};

/**
 * The workspace's tabs as the sidebar lists them. A live session describes its page; a tab
 * not loaded in this app run falls back to what it last showed. Only the workspace page has
 * a current tab: elsewhere nothing in the list is the page on screen.
 */
export function deriveSidebarBrowserTabs(input: {
  readonly tabs: ReadonlyArray<BrowserWorkspaceTab>;
  readonly activeTabId: string | null;
  readonly workspaceShown: boolean;
  readonly sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  readonly desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
}): ReadonlyArray<SidebarBrowserTab> {
  return input.tabs.map((tab) => {
    const snapshot = tab.sessionTabId === null ? undefined : input.sessions[tab.sessionTabId];
    const loaded = snapshot && snapshot.navStatus._tag !== "Idle" ? snapshot.navStatus : null;
    const url = loaded?.url ?? tab.url;
    const pageTitle = (loaded ? loaded.title : (tab.title ?? "")).trim();
    const favicon = snapshot ? (input.desktopByTabId[snapshot.tabId]?.favicon ?? null) : null;
    return {
      tab,
      title:
        tab.customTitle ?? (pageTitle.length > 0 ? pageTitle : url === null ? null : hostOf(url)),
      url,
      capturedFaviconUrl:
        favicon && url && sameOrigin(favicon.pageUrl, url) ? favicon.dataUrl : null,
      active: input.workspaceShown && tab.id === input.activeTabId,
    };
  });
}

export interface RecentlyClosedBrowserTab {
  readonly entry: ClosedViewEntry;
  readonly title: string | null;
  readonly url: string | null;
  readonly host: string | null;
  readonly closedAt: number | null;
}

/** Closed browser tabs from the workspace and every thread, newest first. */
export function recentlyClosedBrowserTabs(
  entries: ReadonlyArray<ClosedViewEntry>,
): ReadonlyArray<RecentlyClosedBrowserTab> {
  return entries.flatMap((entry) => {
    if (entry.kind !== "browser") return [];
    const loaded = entry.snapshot.navStatus._tag === "Idle" ? null : entry.snapshot.navStatus;
    const title = loaded?.title.trim() ?? "";
    const host = loaded ? hostOf(loaded.url) : null;
    return [
      {
        entry,
        title: title.length > 0 ? title : host,
        url: loaded?.url ?? null,
        host,
        closedAt: entry.closedAt ?? null,
      },
    ];
  });
}
