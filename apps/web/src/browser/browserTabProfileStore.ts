import { create } from "zustand";

interface BrowserTabProfileStoreState {
  /** Keyed by runtime tab id: the profile each hosted guest's partition was attached with. */
  readonly byTabId: Record<string, string>;
  readonly publish: (tabId: string, profileId: string) => void;
  readonly clear: (tabId: string) => void;
}

export const useBrowserTabProfileStore = create<BrowserTabProfileStoreState>()((set) => ({
  byTabId: {},
  publish: (tabId, profileId) =>
    set((state) =>
      state.byTabId[tabId] === profileId
        ? state
        : { byTabId: { ...state.byTabId, [tabId]: profileId } },
    ),
  clear: (tabId) =>
    set((state) => {
      if (!(tabId in state.byTabId)) return state;
      const { [tabId]: _removed, ...byTabId } = state.byTabId;
      return { byTabId };
    }),
}));
