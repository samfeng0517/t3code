import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";

/**
 * Workspace tabs live under a thread id no real thread has. The id is per client, stored with
 * the tabs, so windows of one client share a workspace and another client keeps its own.
 */
const WORKSPACE_THREAD_PREFIX = "browser-workspace-";
export const BROWSER_WORKSPACE_HISTORY_PROJECT_KEY = "browser-workspace";
const MAX_TITLE_LENGTH = 512;

export interface BrowserWorkspaceTab {
  readonly id: string;
  readonly url: string | null;
  readonly title: string | null;
  readonly pinned: boolean;
  /** A name the user gave the tab, shown instead of its page title. */
  readonly customTitle?: string;
  readonly profileId?: string;
  /** The live preview session showing this tab, or `null` until it is shown in this app run. */
  readonly sessionTabId: string | null;
}

export type BrowserWorkspaceThreadTarget =
  | { readonly kind: "server"; readonly environmentId: string; readonly threadId: string }
  | { readonly kind: "draft"; readonly draftId: string };

export function browserWorkspaceThreadRef(
  environmentId: EnvironmentId,
  clientId: string,
): ScopedThreadRef {
  return scopeThreadRef(environmentId, ThreadId.make(`${WORKSPACE_THREAD_PREFIX}${clientId}`));
}

export function isBrowserWorkspaceThreadRef(ref: ScopedThreadRef): boolean {
  return ref.threadId.startsWith(WORKSPACE_THREAD_PREFIX);
}

/**
 * The desktop app renders tabs itself, so its own server is the workspace's home. A browser
 * client needs an environment that runs tabs server-side: the one serving it when it can,
 * otherwise the first connected one that can.
 */
export function resolveBrowserWorkspaceEnvironmentId(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly previewInRuntime: boolean;
  readonly supportsServerBrowser: (environmentId: EnvironmentId) => boolean;
}): EnvironmentId | null {
  if (input.previewInRuntime) return input.primaryEnvironmentId;
  if (
    input.primaryEnvironmentId !== null &&
    input.supportsServerBrowser(input.primaryEnvironmentId)
  )
    return input.primaryEnvironmentId;
  return input.environmentIds.find(input.supportsServerBrowser) ?? null;
}

/** Pinned tabs first, each group keeping its relative order. */
function orderBrowserWorkspaceTabs<T extends { readonly pinned: boolean }>(
  tabs: ReadonlyArray<T>,
): T[] {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)];
}

/**
 * New tabs go to the end, like Chrome's new-tab button. A tab opened from another tab goes
 * right after it, but never among the pinned tabs.
 */
export function insertBrowserWorkspaceTab(
  tabs: ReadonlyArray<BrowserWorkspaceTab>,
  tab: BrowserWorkspaceTab,
  afterTabId: string | null = null,
): BrowserWorkspaceTab[] {
  const ordered = orderBrowserWorkspaceTabs(tabs);
  const pinnedCount = ordered.filter((candidate) => candidate.pinned).length;
  if (tab.pinned) return ordered.toSpliced(pinnedCount, 0, tab);
  const afterIndex = afterTabId === null ? -1 : ordered.findIndex((t) => t.id === afterTabId);
  if (afterIndex < 0) return [...ordered, tab];
  return ordered.toSpliced(Math.max(afterIndex + 1, pinnedCount), 0, tab);
}

/** Closing the active tab selects its right neighbour, or the left one at the end. */
export function removeBrowserWorkspaceTab(
  state: { readonly tabs: ReadonlyArray<BrowserWorkspaceTab>; readonly activeTabId: string | null },
  tabId: string,
): { tabs: BrowserWorkspaceTab[]; activeTabId: string | null } {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return { tabs: [...state.tabs], activeTabId: state.activeTabId };
  const tabs = state.tabs.toSpliced(index, 1);
  if (state.activeTabId !== tabId) return { tabs, activeTabId: state.activeTabId };
  return { tabs, activeTabId: (tabs[index] ?? tabs[index - 1])?.id ?? null };
}

/** A newly pinned tab joins the end of the pinned group; an unpinned one leads the rest. */
export function setBrowserWorkspaceTabPinned(
  tabs: ReadonlyArray<BrowserWorkspaceTab>,
  tabId: string,
  pinned: boolean,
): BrowserWorkspaceTab[] {
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.pinned === pinned) return orderBrowserWorkspaceTabs(tabs);
  const rest = orderBrowserWorkspaceTabs(tabs.filter((candidate) => candidate.id !== tabId));
  const pinnedCount = rest.filter((candidate) => candidate.pinned).length;
  return rest.toSpliced(pinnedCount, 0, { ...tab, pinned });
}

/** A blank name clears the custom one, so the tab shows its page title again. */
export function renameBrowserWorkspaceTab(
  tabs: ReadonlyArray<BrowserWorkspaceTab>,
  tabId: string,
  name: string,
): BrowserWorkspaceTab[] {
  const customTitle = name.trim();
  return tabs.map((tab) => {
    if (tab.id !== tabId || (tab.customTitle ?? "") === customTitle) return tab;
    const { customTitle: _previous, ...rest } = tab;
    return customTitle.length > 0 ? { ...rest, customTitle } : rest;
  });
}

/**
 * Where a dragged tab lands when dropped on `overTabId`, or `null` when the drop would cross
 * between pinned and unpinned tabs. Pinning, not dragging, moves a tab across.
 */
export function moveBrowserWorkspaceTab(
  tabs: ReadonlyArray<BrowserWorkspaceTab>,
  tabId: string,
  overTabId: string,
): BrowserWorkspaceTab[] | null {
  if (tabId === overTabId) return null;
  const ordered = orderBrowserWorkspaceTabs(tabs);
  const from = ordered.findIndex((tab) => tab.id === tabId);
  const to = ordered.findIndex((tab) => tab.id === overTabId);
  if (from < 0 || to < 0 || ordered[from]!.pinned !== ordered[to]!.pinned) return null;
  const moved = ordered[from]!;
  return ordered.toSpliced(from, 1).toSpliced(to, 0, moved);
}

export interface BrowserWorkspaceSessionPlan {
  /** Tabs whose session is gone: a server restart or a close elsewhere. They reopen when shown. */
  readonly detachTabIds: ReadonlyArray<string>;
  /** Live sessions that belong to a stored tab without one, such as every tab after a reload. */
  readonly reattach: ReadonlyArray<{ readonly tabId: string; readonly sessionTabId: string }>;
  /** Sessions no stored tab matches: a popup, a link opened in a new tab, another window's tab. */
  readonly adoptSessions: ReadonlyArray<PreviewSessionSnapshot>;
  /** What the live page now shows, so a restart restores where each tab was. */
  readonly updates: ReadonlyArray<{
    readonly tabId: string;
    readonly url: string;
    readonly title: string | null;
    readonly profileId: string | undefined;
  }>;
}

export const snapshotTitle = (snapshot: PreviewSessionSnapshot): string | null => {
  if (snapshot.navStatus._tag === "Idle") return null;
  const title = snapshot.navStatus.title.trim();
  return title.length > 0 ? title : null;
};

const snapshotUrl = (snapshot: PreviewSessionSnapshot): string | null =>
  snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;

/**
 * Matches the workspace's tabs with the environment's sessions for its thread. Sessions are never
 * closed here: one this client does not know may be another window's, or a pre-reload tab whose page
 * is live. An unowned session goes back to a stored tab without a session showing the same url (the
 * server's active one preferring the active tab); only one matching no stored tab becomes a new tab.
 */
export function planBrowserWorkspaceSessions(input: {
  readonly tabs: ReadonlyArray<BrowserWorkspaceTab>;
  readonly activeTabId: string | null;
  readonly sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  readonly activeSessionTabId: string | null;
}): BrowserWorkspaceSessionPlan {
  const owned = new Set<string>();
  const detachTabIds: string[] = [];
  const dormant: BrowserWorkspaceTab[] = [];
  for (const tab of input.tabs) {
    if (tab.sessionTabId !== null && input.sessions[tab.sessionTabId]) {
      owned.add(tab.sessionTabId);
      continue;
    }
    if (tab.sessionTabId !== null) detachTabIds.push(tab.id);
    dormant.push(tab);
  }

  const unowned = Object.values(input.sessions).filter((snapshot) => !owned.has(snapshot.tabId));
  // The active session claims first, so it can take the active tab before another session does.
  unowned.sort(
    (left, right) =>
      Number(right.tabId === input.activeSessionTabId) -
      Number(left.tabId === input.activeSessionTabId),
  );
  const reattach: Array<BrowserWorkspaceSessionPlan["reattach"][number]> = [];
  const adoptSessions: PreviewSessionSnapshot[] = [];
  const sessionByTabId = new Map<string, PreviewSessionSnapshot>();
  for (const snapshot of unowned) {
    const isActive = snapshot.tabId === input.activeSessionTabId;
    const sameUrl = dormant.filter((tab) => tab.url !== null && tab.url === snapshotUrl(snapshot));
    const activeTab = dormant.find((tab) => tab.id === input.activeTabId);
    const match =
      (isActive ? sameUrl.find((tab) => tab.id === input.activeTabId) : undefined) ??
      sameUrl[0] ??
      (isActive ? activeTab : undefined);
    if (!match) {
      adoptSessions.push(snapshot);
      continue;
    }
    dormant.splice(dormant.indexOf(match), 1);
    reattach.push({ tabId: match.id, sessionTabId: snapshot.tabId });
    sessionByTabId.set(match.id, snapshot);
  }

  const updates: Array<BrowserWorkspaceSessionPlan["updates"][number]> = [];
  for (const tab of input.tabs) {
    const snapshot =
      sessionByTabId.get(tab.id) ??
      (tab.sessionTabId === null ? undefined : input.sessions[tab.sessionTabId]);
    if (!snapshot || snapshot.navStatus._tag === "Idle") continue;
    const title = snapshotTitle(snapshot);
    if (
      snapshot.navStatus.url !== tab.url ||
      title !== tab.title ||
      snapshot.profileId !== tab.profileId
    ) {
      updates.push({
        tabId: tab.id,
        url: snapshot.navStatus.url,
        title,
        profileId: snapshot.profileId,
      });
    }
  }
  return { detachTabIds, reattach, adoptSessions, updates };
}

/**
 * Stands in for the session of a tab that was never shown in this app run, so closing it
 * still leaves an entry that "reopen closed tab" brings back.
 */
export function dormantBrowserWorkspaceSnapshot(
  tab: BrowserWorkspaceTab,
  threadId: string,
  updatedAt: string,
): PreviewSessionSnapshot {
  return {
    threadId,
    tabId: tab.id,
    navStatus:
      tab.url === null
        ? { _tag: "Idle" }
        : { _tag: "Success", url: tab.url, title: (tab.title ?? "").slice(0, MAX_TITLE_LENGTH) },
    canGoBack: false,
    canGoForward: false,
    ...(tab.profileId === undefined ? {} : { profileId: tab.profileId }),
    updatedAt,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** Tabs from storage, dropping anything malformed. Sessions never survive a reload. */
export function sanitizePersistedBrowserWorkspaceTabs(raw: unknown): BrowserWorkspaceTab[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tabs: BrowserWorkspaceTab[] = [];
  for (const candidate of raw) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || seen.has(candidate.id))
      continue;
    seen.add(candidate.id);
    const profileId = optionalString(candidate.profileId);
    const customTitle = optionalString(candidate.customTitle);
    tabs.push({
      id: candidate.id,
      url: optionalString(candidate.url),
      title: optionalString(candidate.title),
      pinned: candidate.pinned === true,
      ...(customTitle === null ? {} : { customTitle }),
      ...(profileId === null ? {} : { profileId }),
      sessionTabId: null,
    });
  }
  return orderBrowserWorkspaceTabs(tabs);
}

export function sanitizeBrowserWorkspaceThreadTarget(
  raw: unknown,
): BrowserWorkspaceThreadTarget | null {
  if (!isRecord(raw)) return null;
  if (
    raw.kind === "server" &&
    typeof raw.environmentId === "string" &&
    typeof raw.threadId === "string"
  ) {
    return { kind: "server", environmentId: raw.environmentId, threadId: raw.threadId };
  }
  if (raw.kind === "draft" && typeof raw.draftId === "string") {
    return { kind: "draft", draftId: raw.draftId };
  }
  return null;
}
