import { scopedProjectKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, type ProjectId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useClosedViewStore } from "../../closedViewStore";
import { resolveStorage } from "../../lib/storage";

/** Owner of the Git page's closed tabs, which reopen on `/git` from anywhere. */
export const GIT_PAGE_REF = scopeThreadRef(
  EnvironmentId.make("git-page"),
  ThreadId.make("git-page"),
);

export interface GitTab {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}

export const gitTabKey = (tab: GitTab): string => scopedProjectKey(tab);

interface GitTabsStoreState {
  tabs: GitTab[];
  activeKey: string | null;
  open: (tab: GitTab) => void;
  close: (key: string) => void;
  activate: (key: string) => void;
}

type PersistedGitTabs = Pick<GitTabsStoreState, "tabs" | "activeKey">;

const isGitTab = (value: unknown): value is GitTab => {
  const tab = value as Partial<GitTab> | null;
  return !!tab && typeof tab.environmentId === "string" && typeof tab.projectId === "string";
};

const sanitizePersistedTabs = (persisted: unknown): PersistedGitTabs => {
  const state = persisted as Partial<PersistedGitTabs> | null;
  const tabs = Array.isArray(state?.tabs)
    ? state.tabs
        .filter(isGitTab)
        .map(({ environmentId, projectId }) => ({ environmentId, projectId }))
    : [];
  const activeKey = tabs.some((tab) => gitTabKey(tab) === state?.activeKey)
    ? (state?.activeKey ?? null)
    : tabs[0] === undefined
      ? null
      : gitTabKey(tabs[0]);
  return { tabs, activeKey };
};

export const useGitTabsStore = create<GitTabsStoreState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeKey: null,
      open: (tab) => {
        const key = gitTabKey(tab);
        set((state) => ({
          tabs: state.tabs.some((existing) => gitTabKey(existing) === key)
            ? state.tabs
            : [...state.tabs, { environmentId: tab.environmentId, projectId: tab.projectId }],
          activeKey: key,
        }));
      },
      close: (key) => {
        const { tabs, activeKey } = get();
        const index = tabs.findIndex((tab) => gitTabKey(tab) === key);
        const closed = tabs[index];
        if (closed === undefined) return;
        const neighbor = tabs[index + 1] ?? tabs[index - 1];
        set({
          tabs: tabs.filter((_, tabIndex) => tabIndex !== index),
          activeKey:
            activeKey !== key ? activeKey : neighbor === undefined ? null : gitTabKey(neighbor),
        });
        useClosedViewStore.getState().remember({
          kind: "git-tab",
          threadRef: GIT_PAGE_REF,
          environmentId: closed.environmentId,
          projectId: closed.projectId,
        });
      },
      activate: (key) =>
        set((state) =>
          state.tabs.some((tab) => gitTabKey(tab) === key) ? { activeKey: key } : state,
        ),
    }),
    {
      name: "t3code:git-tabs:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
      partialize: ({ tabs, activeKey }): PersistedGitTabs => ({ tabs, activeKey }),
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedTabs(persisted) }),
    },
  ),
);
