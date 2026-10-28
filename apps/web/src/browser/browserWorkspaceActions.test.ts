import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_CLIENT_SETTINGS,
  type EnvironmentId,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { browserWorkspaceThreadRef } from "~/browserWorkspace.logic";
import { isBrowserWorkspaceOpening, useBrowserWorkspaceStore } from "~/browserWorkspaceStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import {
  applyPreviewServerEvent,
  readThreadPreviewState,
  reconcilePreviewServerSessions,
  resetPreviewStateForTests,
} from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";

import {
  closeBrowserWorkspaceTab,
  moveThreadBrowserToWorkspace,
  openBrowserWorkspaceTabSession,
  setBrowserWorkspaceEnvironment,
} from "./browserWorkspaceActions";
import { openUrlInPreview } from "./openFileInPreview";

vi.mock("~/state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/state/session")>()),
  readEnvironmentScope: () => true,
}));

const environmentId = "env-1" as EnvironmentId;
const otherEnvironmentId = "env-2" as EnvironmentId;
const clientId = "client-1";
const store = () => useBrowserWorkspaceStore.getState();
const workspaceRef = (environment = environmentId) =>
  browserWorkspaceThreadRef(environment, clientId);
const activeTab = () => store().tabs.find((tab) => tab.id === store().activeTabId);

const snapshot = (ref: ScopedThreadRef, tabId: string, url: string): PreviewSessionSnapshot => ({
  threadId: ref.threadId,
  tabId,
  navStatus: { _tag: "Success", url, title: tabId },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-22T00:00:00.000Z",
});

let revision = 1;
const announceOpened = (ref: ScopedThreadRef, opened: PreviewSessionSnapshot) => {
  revision += 1;
  applyPreviewServerEvent(ref, {
    type: "opened",
    threadId: ref.threadId,
    tabId: opened.tabId,
    createdAt: opened.updatedAt,
    serverEpoch: "epoch-1",
    revision,
    snapshot: opened,
  });
};

// What BrowserWorkspaceController's session sync does after every render.
const syncSessions = (ref: ScopedThreadRef) => {
  const preview = readThreadPreviewState(ref);
  if (!preview.listLoaded || isBrowserWorkspaceOpening(store())) return;
  store().syncSessions({ sessions: preview.sessions, activeSessionTabId: preview.activeTabId });
};

const loadSessions = (ref: ScopedThreadRef, sessions: PreviewSessionSnapshot[]) => {
  revision += 1;
  reconcilePreviewServerSessions(ref, { sessions, serverEpoch: "epoch-1", revision });
};

const closeSucceeds = () => vi.fn(async (_input: unknown) => AsyncResult.success(undefined));

beforeEach(() => {
  resetPreviewStateForTests();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  useRightPanelStore.setState({ byThreadKey: {}, threadPanelVisibilityByThreadKey: {} });
  useBrowserWorkspaceStore.setState({
    clientId,
    environmentId,
    available: true,
    tabs: [],
    activeTabId: null,
    openStatusByTabId: {},
    pendingShowSessionTabId: null,
  });
});

describe("openBrowserWorkspaceTabSession", () => {
  it("should close the landed session and adopt nothing when its tab closes while the open is in flight", async () => {
    const ref = workspaceRef();
    loadSessions(ref, []);
    const tabId = store().addTab({});
    const landed = snapshot(ref, "s-1", "about:blank");
    let markCalled!: () => void;
    const called = new Promise<void>((resolve) => {
      markCalled = resolve;
    });
    let reply!: (result: AtomCommandResult<PreviewSessionSnapshot, never>) => void;
    const replied = new Promise<AtomCommandResult<PreviewSessionSnapshot, never>>((resolve) => {
      reply = resolve;
    });
    const openPreview = vi.fn((_input: unknown) => {
      markCalled();
      return replied;
    });
    const closePreview = closeSucceeds();
    // Sync on every workspace change, as eagerly as the controller's effect could.
    const unsubscribe = useBrowserWorkspaceStore.subscribe(() => syncSessions(ref));

    const opening = openBrowserWorkspaceTabSession({
      threadRef: ref,
      tabId,
      openPreview,
      closePreview,
    });
    await called;
    announceOpened(ref, landed);
    syncSessions(ref);
    await closeBrowserWorkspaceTab({ tabId, closePreview });
    reply(AsyncResult.success(landed));
    await opening;
    unsubscribe();

    expect(store().tabs).toEqual([]);
    expect(closePreview).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId: ref.threadId, tabId: "s-1" },
    });
    expect(readThreadPreviewState(ref).sessions).toEqual({});
    expect(isBrowserWorkspaceOpening(store())).toBe(false);
  });

  it("should reattach the tab's live session instead of opening another when the page shows the tab before the session sync runs", async () => {
    const ref = workspaceRef();
    // After a reload the stored tab has no session yet, though its page is still live.
    loadSessions(ref, [snapshot(ref, "s-1", "https://a.example/")]);
    const tabId = store().addTab({ url: "https://a.example/" });
    const openPreview = vi.fn(async (_input: unknown) =>
      AsyncResult.success(snapshot(ref, "s-2", "https://a.example/")),
    );

    await openBrowserWorkspaceTabSession({
      threadRef: ref,
      tabId,
      openPreview,
      closePreview: closeSucceeds(),
    });
    syncSessions(ref);

    expect(openPreview).not.toHaveBeenCalled();
    expect(store().tabs.map((tab) => [tab.id, tab.sessionTabId])).toEqual([[tabId, "s-1"]]);
  });
});

describe("closeBrowserWorkspaceTab", () => {
  it("should close the tab's session without the sync adopting it back when a live tab closes", async () => {
    const ref = workspaceRef();
    loadSessions(ref, [snapshot(ref, "s-1", "https://a.example/")]);
    const a = store().addTab({ url: "https://a.example/" });
    store().attachSession(a, "s-1");
    const closePreview = closeSucceeds();
    const unsubscribe = useBrowserWorkspaceStore.subscribe(() => syncSessions(ref));

    await closeBrowserWorkspaceTab({ tabId: a, closePreview });
    unsubscribe();

    expect(store().tabs).toEqual([]);
    expect(closePreview).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId: ref.threadId, tabId: "s-1" },
    });
  });
});

describe("setBrowserWorkspaceEnvironment", () => {
  it("should close the workspace's sessions on the old environment when the workspace moves to another one", () => {
    const ref = workspaceRef();
    loadSessions(ref, [snapshot(ref, "s-1", "https://a.example/")]);
    const a = store().addTab({ url: "https://a.example/" });
    store().attachSession(a, "s-1");
    const closePreview = closeSucceeds();

    setBrowserWorkspaceEnvironment({ environmentId: otherEnvironmentId, closePreview });

    expect(closePreview).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId: ref.threadId, tabId: "s-1" },
    });
    expect(readThreadPreviewState(ref).sessions).toEqual({});
    expect(store()).toMatchObject({ environmentId: otherEnvironmentId, available: true });
    expect(store().tabs[0]?.sessionTabId).toBeNull();
  });

  it("should close nothing when the environment only becomes unavailable", () => {
    const a = store().addTab({ url: "https://a.example/" });
    store().attachSession(a, "s-1");
    const closePreview = closeSucceeds();

    setBrowserWorkspaceEnvironment({ environmentId: null, closePreview });

    expect(closePreview).not.toHaveBeenCalled();
    expect(store().available).toBe(false);
    expect(store().tabs[0]?.sessionTabId).toBe("s-1");
  });
});

describe("moveThreadBrowserToWorkspace", () => {
  const threadRef = {
    environmentId,
    threadId: ThreadId.make("thread-1"),
  } satisfies ScopedThreadRef;
  const panelTab = snapshot(threadRef, "panel-1", "https://docs.example/");

  it("should add the workspace tab before closing the panel's session when moving it", async () => {
    useRightPanelStore.getState().openBrowser(threadRef, panelTab.tabId);
    const workspaceUrlsAtClose: Array<Array<string | null>> = [];
    const closePreview = vi.fn(async (_input: unknown) => {
      workspaceUrlsAtClose.push(store().tabs.map((tab) => tab.url));
      return AsyncResult.success(undefined);
    });

    await expect(
      moveThreadBrowserToWorkspace({ threadRef, snapshot: panelTab, closePreview }),
    ).resolves.toBe(true);

    expect(workspaceUrlsAtClose).toEqual([["https://docs.example/"]]);
    expect(activeTab()?.url).toBe("https://docs.example/");
  });

  it("should leave the panel tab alone and add no workspace tab when closing its session fails", async () => {
    const before = store().addTab({ url: "https://a.example/" });
    const closePreview = vi.fn(async (_input: unknown): Promise<AtomCommandResult<void, Error>> =>
      AsyncResult.failure(Cause.fail(new Error("offline"))),
    );

    await expect(
      moveThreadBrowserToWorkspace({ threadRef, snapshot: panelTab, closePreview }),
    ).resolves.toBe(false);

    expect(store().tabs.map((tab) => tab.url)).toEqual(["https://a.example/"]);
    expect(store().activeTabId).toBe(before);
  });

  it("should close nothing when the workspace is unavailable", async () => {
    useBrowserWorkspaceStore.setState({ available: false });
    const closePreview = closeSucceeds();

    await expect(
      moveThreadBrowserToWorkspace({ threadRef, snapshot: panelTab, closePreview }),
    ).resolves.toBe(false);

    expect(closePreview).not.toHaveBeenCalled();
  });
});

describe("openUrlInPreview in the workspace", () => {
  const openAnnouncingFirst = (ref: ScopedThreadRef, opened: PreviewSessionSnapshot) =>
    vi.fn(async (_input: unknown) => {
      // The server's "opened" event can beat the RPC reply.
      announceOpened(ref, opened);
      syncSessions(ref);
      return AsyncResult.success(opened);
    });

  it("should keep the current workspace tab selected when a link opens in the background", async () => {
    const ref = workspaceRef();
    loadSessions(ref, [snapshot(ref, "s-1", "https://a.example/")]);
    const a = store().addTab({ url: "https://a.example/" });
    store().attachSession(a, "s-1");
    const opened = snapshot(ref, "s-2", "https://b.example/");

    await openUrlInPreview({
      threadRef: ref,
      url: "https://b.example/",
      openPreview: openAnnouncingFirst(ref, opened),
      background: true,
    });
    syncSessions(ref);

    expect(store().tabs.map((tab) => tab.sessionTabId)).toEqual(["s-1", "s-2"]);
    expect(store().activeTabId).toBe(a);
  });

  it("should select the new workspace tab when a link opens in the foreground", async () => {
    const ref = workspaceRef();
    loadSessions(ref, [snapshot(ref, "s-1", "https://a.example/")]);
    const a = store().addTab({ url: "https://a.example/" });
    store().attachSession(a, "s-1");
    const opened = snapshot(ref, "s-2", "https://b.example/");

    await openUrlInPreview({
      threadRef: ref,
      url: "https://b.example/",
      openPreview: openAnnouncingFirst(ref, opened),
    });
    syncSessions(ref);

    expect(activeTab()?.sessionTabId).toBe("s-2");
  });
});
