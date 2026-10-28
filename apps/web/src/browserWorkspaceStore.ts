import {
  type EnvironmentId,
  INCOGNITO_BROWSER_PROFILE_ID,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  type BrowserWorkspaceTab,
  type BrowserWorkspaceThreadTarget,
  insertBrowserWorkspaceTab,
  moveBrowserWorkspaceTab,
  planBrowserWorkspaceSessions,
  removeBrowserWorkspaceTab,
  renameBrowserWorkspaceTab,
  sanitizeBrowserWorkspaceThreadTarget,
  sanitizePersistedBrowserWorkspaceTabs,
  setBrowserWorkspaceTabPinned,
  snapshotTitle,
} from "./browserWorkspace.logic";
import { resolveStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";

export type BrowserWorkspaceOpenStatus = "opening" | "failed";

interface BrowserWorkspaceStoreState {
  /**
   * Names this client's workspace thread; see `browserWorkspaceThreadRef`. Clearing site data
   * mints a new id, and the old id's sessions stay on the server, unseen, until it restarts.
   */
  clientId: string;
  environmentId: EnvironmentId | null;
  /** Whether `environmentId` can run browser tabs right now; never persisted. */
  available: boolean;
  tabs: BrowserWorkspaceTab[];
  activeTabId: string | null;
  /** The thread a workspace tab moves to: the one the user looked at last. */
  lastThreadTarget: BrowserWorkspaceThreadTarget | null;
  /**
   * Keyed by tab id. An open outlives its tab when the tab closes mid-open, so the session sync
   * keeps waiting until that session lands and is closed.
   */
  openStatusByTabId: Record<string, BrowserWorkspaceOpenStatus>;
  /** A session a foreground open asked to show before any tab holds it. */
  pendingShowSessionTabId: string | null;
  /** `null` hides the workspace until an environment can run tabs again, keeping its tabs. */
  setEnvironment: (environmentId: EnvironmentId | null) => void;
  addTab: (
    input: {
      readonly url?: string | null;
      readonly title?: string | null;
      readonly profileId?: string | undefined;
    },
    afterTabId?: string | null,
  ) => string;
  activateTab: (tabId: string) => void;
  removeTab: (tabId: string) => BrowserWorkspaceTab | null;
  setPinned: (tabId: string, pinned: boolean) => void;
  renameTab: (tabId: string, name: string) => void;
  moveTab: (tabId: string, overTabId: string) => void;
  setOpenStatus: (tabId: string, status: BrowserWorkspaceOpenStatus | null) => void;
  attachSession: (tabId: string, sessionTabId: string) => void;
  syncSessions: (input: {
    readonly sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
    readonly activeSessionTabId: string | null;
  }) => void;
  /** Selects the tab showing a session, as a thread's panel does for a foreground open. */
  showSession: (sessionTabId: string) => void;
  setLastThreadTarget: (target: BrowserWorkspaceThreadTarget) => void;
}

type PersistedBrowserWorkspace = Pick<
  BrowserWorkspaceStoreState,
  "clientId" | "environmentId" | "activeTabId" | "lastThreadTarget"
> & { tabs: Array<Omit<BrowserWorkspaceTab, "sessionTabId">> };

const sameThreadTarget = (
  left: BrowserWorkspaceThreadTarget | null,
  right: BrowserWorkspaceThreadTarget,
): boolean =>
  left !== null &&
  (left.kind === "server"
    ? right.kind === "server" &&
      left.environmentId === right.environmentId &&
      left.threadId === right.threadId
    : right.kind === "draft" && left.draftId === right.draftId);

const withoutStatus = (statuses: Record<string, BrowserWorkspaceOpenStatus>, tabId: string) => {
  if (!(tabId in statuses)) return statuses;
  const { [tabId]: _removed, ...rest } = statuses;
  return rest;
};

export const useBrowserWorkspaceStore = create<BrowserWorkspaceStoreState>()(
  persist(
    (set, get) => ({
      clientId: randomUUID(),
      environmentId: null,
      available: false,
      tabs: [],
      activeTabId: null,
      lastThreadTarget: null,
      openStatusByTabId: {},
      pendingShowSessionTabId: null,
      setEnvironment: (environmentId) =>
        set((state) => {
          if (environmentId === null) return state.available ? { available: false } : state;
          if (state.environmentId === environmentId)
            return state.available ? state : { available: true };
          return {
            environmentId,
            available: true,
            tabs: state.tabs.map((tab) => ({ ...tab, sessionTabId: null })),
            openStatusByTabId: {},
            pendingShowSessionTabId: null,
          };
        }),
      addTab: (input, afterTabId = null) => {
        const id = randomUUID();
        const tab: BrowserWorkspaceTab = {
          id,
          url: input.url ?? null,
          title: input.title ?? null,
          pinned: false,
          ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
          sessionTabId: null,
        };
        set((state) => ({
          tabs: insertBrowserWorkspaceTab(state.tabs, tab, afterTabId),
          activeTabId: id,
        }));
        return id;
      },
      activateTab: (tabId) =>
        set((state) =>
          state.activeTabId === tabId || !state.tabs.some((tab) => tab.id === tabId)
            ? state
            : { activeTabId: tabId },
        ),
      removeTab: (tabId) => {
        const removed = get().tabs.find((tab) => tab.id === tabId) ?? null;
        if (!removed) return null;
        set((state) => ({
          ...removeBrowserWorkspaceTab(state, tabId),
          openStatusByTabId:
            state.openStatusByTabId[tabId] === "opening"
              ? state.openStatusByTabId
              : withoutStatus(state.openStatusByTabId, tabId),
        }));
        return removed;
      },
      setPinned: (tabId, pinned) =>
        set((state) => ({ tabs: setBrowserWorkspaceTabPinned(state.tabs, tabId, pinned) })),
      renameTab: (tabId, name) =>
        set((state) => {
          const tabs = renameBrowserWorkspaceTab(state.tabs, tabId, name);
          return tabs.every((tab, index) => tab === state.tabs[index]) ? state : { tabs };
        }),
      moveTab: (tabId, overTabId) =>
        set((state) => {
          const tabs = moveBrowserWorkspaceTab(state.tabs, tabId, overTabId);
          return tabs ? { tabs } : state;
        }),
      setOpenStatus: (tabId, status) =>
        set((state) => {
          if (status === null) {
            const openStatusByTabId = withoutStatus(state.openStatusByTabId, tabId);
            return openStatusByTabId === state.openStatusByTabId ? state : { openStatusByTabId };
          }
          if (!state.tabs.some((tab) => tab.id === tabId)) return state;
          return { openStatusByTabId: { ...state.openStatusByTabId, [tabId]: status } };
        }),
      attachSession: (tabId, sessionTabId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, sessionTabId } : tab)),
          openStatusByTabId: withoutStatus(state.openStatusByTabId, tabId),
        })),
      syncSessions: ({ sessions, activeSessionTabId }) =>
        set((state) => {
          const plan = planBrowserWorkspaceSessions({
            tabs: state.tabs,
            activeTabId: state.activeTabId,
            sessions,
            activeSessionTabId,
          });
          if (
            plan.detachTabIds.length === 0 &&
            plan.reattach.length === 0 &&
            plan.adoptSessions.length === 0 &&
            plan.updates.length === 0
          ) {
            return state;
          }
          const detached = new Set(plan.detachTabIds);
          const reattached = new Map(plan.reattach.map((entry) => [entry.tabId, entry]));
          const updates = new Map(plan.updates.map((update) => [update.tabId, update]));
          let openStatusByTabId = state.openStatusByTabId;
          let tabs = state.tabs.map((tab) => {
            const sessionTabId =
              reattached.get(tab.id)?.sessionTabId ??
              (detached.has(tab.id) ? null : tab.sessionTabId);
            if (reattached.has(tab.id))
              openStatusByTabId = withoutStatus(openStatusByTabId, tab.id);
            const update = updates.get(tab.id);
            if (!update) return sessionTabId === tab.sessionTabId ? tab : { ...tab, sessionTabId };
            const { profileId: _profileId, ...rest } = tab;
            return {
              ...rest,
              url: update.url,
              title: update.title,
              ...(update.profileId === undefined ? {} : { profileId: update.profileId }),
              sessionTabId,
            };
          });
          let openerTabId = state.activeTabId;
          for (const snapshot of plan.adoptSessions) {
            const id = randomUUID();
            tabs = insertBrowserWorkspaceTab(
              tabs,
              {
                id,
                url: snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url,
                title: snapshotTitle(snapshot),
                pinned: false,
                ...(snapshot.profileId === undefined ? {} : { profileId: snapshot.profileId }),
                sessionTabId: snapshot.tabId,
              },
              openerTabId,
            );
            openerTabId = id;
          }
          const shown =
            state.pendingShowSessionTabId === null
              ? undefined
              : tabs.find((tab) => tab.sessionTabId === state.pendingShowSessionTabId);
          return {
            tabs,
            openStatusByTabId,
            ...(shown ? { activeTabId: shown.id, pendingShowSessionTabId: null } : {}),
          };
        }),
      showSession: (sessionTabId) =>
        set((state) => {
          const tab = state.tabs.find((candidate) => candidate.sessionTabId === sessionTabId);
          return tab
            ? { activeTabId: tab.id, pendingShowSessionTabId: null }
            : { pendingShowSessionTabId: sessionTabId };
        }),
      setLastThreadTarget: (target) =>
        set((state) =>
          sameThreadTarget(state.lastThreadTarget, target) ? state : { lastThreadTarget: target },
        ),
    }),
    {
      name: "t3code:browser-workspace:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      // Incognito tabs, like their closed-tab history, stay in memory only.
      partialize: (state): PersistedBrowserWorkspace => {
        const tabs = state.tabs
          .filter((tab) => tab.profileId !== INCOGNITO_BROWSER_PROFILE_ID)
          .map(({ sessionTabId: _sessionTabId, ...tab }) => tab);
        return {
          clientId: state.clientId,
          environmentId: state.environmentId,
          tabs,
          activeTabId: tabs.some((tab) => tab.id === state.activeTabId)
            ? state.activeTabId
            : (tabs[0]?.id ?? null),
          lastThreadTarget: state.lastThreadTarget,
        };
      },
      merge: (persisted, current) => {
        const raw = (persisted ?? {}) as Partial<Record<keyof PersistedBrowserWorkspace, unknown>>;
        const tabs = sanitizePersistedBrowserWorkspaceTabs(raw.tabs);
        return {
          ...current,
          clientId:
            typeof raw.clientId === "string" && raw.clientId.length > 0
              ? raw.clientId
              : current.clientId,
          environmentId:
            typeof raw.environmentId === "string" && raw.environmentId.length > 0
              ? (raw.environmentId as EnvironmentId)
              : null,
          tabs,
          activeTabId: tabs.some((tab) => tab.id === raw.activeTabId)
            ? (raw.activeTabId as string)
            : (tabs[0]?.id ?? null),
          lastThreadTarget: sanitizeBrowserWorkspaceThreadTarget(raw.lastThreadTarget),
          available: false,
          openStatusByTabId: {},
          pendingShowSessionTabId: null,
        };
      },
    },
  ),
);

/** A session being opened belongs to no tab yet; the session sync must not reattach or adopt it. */
export function isBrowserWorkspaceOpening(state: {
  readonly openStatusByTabId: Readonly<Record<string, BrowserWorkspaceOpenStatus>>;
}): boolean {
  return Object.values(state.openStatusByTabId).includes("opening");
}

export function selectActiveBrowserWorkspaceTab(state: {
  readonly tabs: ReadonlyArray<BrowserWorkspaceTab>;
  readonly activeTabId: string | null;
}): BrowserWorkspaceTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

export function selectBrowserWorkspaceEnvironmentId(state: {
  readonly environmentId: EnvironmentId | null;
  readonly available: boolean;
}): EnvironmentId | null {
  return state.available ? state.environmentId : null;
}

/**
 * Opens a closed browser tab, from the workspace or any thread, as the current workspace tab.
 * Returns the new tab's id, or `null` when no environment can run the workspace.
 */
export function reopenInBrowserWorkspace(snapshot: PreviewSessionSnapshot): string | null {
  const store = useBrowserWorkspaceStore.getState();
  if (selectBrowserWorkspaceEnvironmentId(store) === null) return null;
  const loaded = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus;
  return store.addTab({
    url: loaded?.url ?? null,
    title: loaded?.title.trim() || null,
    profileId: snapshot.profileId,
  });
}
