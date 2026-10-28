import {
  type EnvironmentId,
  INCOGNITO_BROWSER_PROFILE_ID,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { isBrowserWorkspaceOpening, useBrowserWorkspaceStore } from "./browserWorkspaceStore";

const environmentId = "env-1" as EnvironmentId;

const store = () => useBrowserWorkspaceStore.getState();
const tabIds = () => store().tabs.map((tab) => tab.id);
const persisted = () => {
  const { storage, name } = useBrowserWorkspaceStore.persist.getOptions();
  return storage!.getItem(name!) as { state: Record<string, unknown> & { tabs: unknown[] } } | null;
};

const snapshot = (tabId: string, url: string): PreviewSessionSnapshot => ({
  threadId: "browser-workspace-client",
  tabId,
  navStatus: { _tag: "Success", url, title: tabId },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-22T00:00:00.000Z",
});
const sessions = (...snapshots: PreviewSessionSnapshot[]) =>
  Object.fromEntries(snapshots.map((entry) => [entry.tabId, entry]));

beforeEach(() => {
  useBrowserWorkspaceStore.setState({
    environmentId,
    available: true,
    tabs: [],
    activeTabId: null,
    lastThreadTarget: null,
    openStatusByTabId: {},
    pendingShowSessionTabId: null,
  });
});

describe("useBrowserWorkspaceStore", () => {
  it("should keep pinned tabs first when tabs are added, pinned and dragged", () => {
    const a = store().addTab({ url: "https://a.example/" });
    const b = store().addTab({ url: "https://b.example/" });
    const c = store().addTab({ url: "https://c.example/" });
    store().setPinned(c, true);
    expect(tabIds()).toEqual([c, a, b]);

    store().moveTab(b, c);
    expect(tabIds()).toEqual([c, a, b]);
    store().moveTab(b, a);
    expect(tabIds()).toEqual([c, b, a]);
    expect(store().activeTabId).toBe(c);
  });

  it("should save tabs, order, pins and the active tab but not live sessions when persisting", () => {
    const a = store().addTab({ url: "https://a.example/", title: "A" });
    const b = store().addTab({ url: "https://b.example/" });
    store().setPinned(b, true);
    store().attachSession(a, "session-a");
    store().activateTab(a);

    const saved = persisted();
    expect(saved?.state).toMatchObject({
      environmentId,
      activeTabId: a,
      tabs: [
        { id: b, url: "https://b.example/", pinned: true },
        { id: a, url: "https://a.example/", title: "A", pinned: false },
      ],
    });
    expect(saved?.state.tabs[1]).not.toHaveProperty("sessionTabId");
    expect(saved?.state).not.toHaveProperty("openStatusByTabId");
  });

  it("should restore saved tabs without sessions when the app reloads", async () => {
    const { storage, name } = useBrowserWorkspaceStore.persist.getOptions();
    await storage!.setItem(name!, {
      state: {
        clientId: "client-1",
        environmentId,
        tabs: [
          { id: "a", url: "https://a.example/", title: "A", pinned: false },
          { id: "p", url: "https://p.example/", title: null, pinned: true },
        ],
        activeTabId: "a",
        lastThreadTarget: { kind: "server", environmentId, threadId: "thread-1" },
      },
      version: 1,
    });
    await useBrowserWorkspaceStore.persist.rehydrate();

    expect(store()).toMatchObject({
      clientId: "client-1",
      activeTabId: "a",
      lastThreadTarget: { kind: "server", threadId: "thread-1" },
      tabs: [
        { id: "p", pinned: true, sessionTabId: null },
        { id: "a", pinned: false, sessionTabId: null },
      ],
    });
  });

  it("should leave incognito tabs out of storage when persisting", () => {
    store().addTab({ url: "https://private.example/", profileId: INCOGNITO_BROWSER_PROFILE_ID });
    const kept = store().addTab({ url: "https://kept.example/" });

    const saved = persisted();
    expect(saved?.state.tabs.map((tab) => (tab as { id: string }).id)).toEqual([kept]);
  });

  it("should forget every live session when the workspace moves to another environment", () => {
    const a = store().addTab({ url: "https://a.example/" });
    store().attachSession(a, "session-a");
    store().setEnvironment("env-2" as EnvironmentId);
    expect(store().environmentId).toBe("env-2");
    expect(store().tabs[0]?.sessionTabId).toBeNull();
  });

  it("should insert an adopted session after the active tab without selecting it when nothing asked to show it", () => {
    const a = store().addTab({ url: "https://a.example/" });
    const b = store().addTab({ url: "https://b.example/" });
    store().activateTab(a);
    store().attachSession(a, "s-a");
    store().attachSession(b, "s-b");
    store().syncSessions({
      sessions: sessions(
        snapshot("s-a", "https://a.example/"),
        snapshot("s-b", "https://b.example/"),
        snapshot("popup", "https://popup.example/"),
      ),
      activeSessionTabId: "popup",
    });
    const popup = store().tabs[1];
    expect(tabIds()).toEqual([a, popup?.id, b]);
    expect(popup).toMatchObject({ url: "https://popup.example/", sessionTabId: "popup" });
    expect(store().activeTabId).toBe(a);
  });

  it("should select the adopted tab when a foreground open asked to show its session first", () => {
    const a = store().addTab({ url: "https://a.example/" });
    store().attachSession(a, "s-a");
    store().showSession("popup");
    store().syncSessions({
      sessions: sessions(
        snapshot("s-a", "https://a.example/"),
        snapshot("popup", "https://popup.example/"),
      ),
      activeSessionTabId: "popup",
    });
    expect(store().tabs.find((tab) => tab.id === store().activeTabId)?.sessionTabId).toBe("popup");
  });

  it("should select the tab owning a session when a foreground open asks to show it after adoption", () => {
    const a = store().addTab({ url: "https://a.example/" });
    store().attachSession(a, "s-a");
    store().syncSessions({
      sessions: sessions(
        snapshot("s-a", "https://a.example/"),
        snapshot("popup", "https://popup.example/"),
      ),
      activeSessionTabId: "popup",
    });
    expect(store().activeTabId).toBe(a);
    store().showSession("popup");
    expect(store().tabs.find((tab) => tab.id === store().activeTabId)?.sessionTabId).toBe("popup");
  });

  it("should reattach instead of duplicating tabs when the workspace returns to an environment whose sessions survived", () => {
    const a = store().addTab({ url: "https://a.example/" });
    const b = store().addTab({ url: "https://b.example/" });
    store().attachSession(a, "s-1");
    store().attachSession(b, "s-2");
    const live = sessions(
      snapshot("s-1", "https://a.example/"),
      snapshot("s-2", "https://b.example/"),
    );
    store().setEnvironment("env-2" as EnvironmentId);
    store().setEnvironment(environmentId);
    store().syncSessions({ sessions: live, activeSessionTabId: "s-2" });
    expect(store().tabs.map((tab) => [tab.id, tab.sessionTabId])).toEqual([
      [a, "s-1"],
      [b, "s-2"],
    ]);
  });

  it("should keep an open in flight when its tab is closed so its session is never adopted", () => {
    const a = store().addTab({});
    store().setOpenStatus(a, "opening");
    store().removeTab(a);
    expect(isBrowserWorkspaceOpening(store())).toBe(true);
    store().setOpenStatus(a, null);
    expect(isBrowserWorkspaceOpening(store())).toBe(false);
  });
});
