import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  AuthPreviewOperateScope,
  type EnvironmentId,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";

import {
  type BrowserWorkspaceTab,
  browserWorkspaceThreadRef,
  dormantBrowserWorkspaceSnapshot,
} from "~/browserWorkspace.logic";
import {
  isBrowserWorkspaceOpening,
  reopenInBrowserWorkspace,
  selectBrowserWorkspaceEnvironmentId,
  useBrowserWorkspaceStore,
} from "~/browserWorkspaceStore";
import { useClosedViewStore } from "~/closedViewStore";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import {
  type ClosePreviewMutation,
  closePreviewSession,
} from "~/components/preview/closePreviewSession";
import { openPreviewSession } from "~/components/preview/openPreviewSession";
import { readThreadPreviewState, setActivePreviewTab } from "~/previewStateStore";
import {
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "~/rightPanelStore";
import { readThreadShell } from "~/state/entities";
import { readEnvironmentScope } from "~/state/session";
import type { ThreadRouteTarget } from "~/threadRoutes";

import type { OpenPreviewMutation } from "./openFileInPreview";
import { isPreviewAvailableFor } from "./previewRuntime";

/**
 * Points the workspace at the environment that runs its tabs. Moving to another environment
 * closes the sessions left on the old one, so coming back cannot turn them into extra tabs.
 */
export function setBrowserWorkspaceEnvironment<E>(input: {
  readonly environmentId: EnvironmentId | null;
  readonly closePreview: ClosePreviewMutation<E>;
}): void {
  const state = useBrowserWorkspaceStore.getState();
  const previous = state.environmentId;
  if (
    input.environmentId !== null &&
    previous !== null &&
    previous !== input.environmentId &&
    readEnvironmentScope(previous, AuthPreviewOperateScope)
  ) {
    const threadRef = browserWorkspaceThreadRef(previous, state.clientId);
    const { sessions } = readThreadPreviewState(threadRef);
    for (const tab of state.tabs) {
      if (tab.sessionTabId === null) continue;
      void closePreviewSession({
        closePreview: input.closePreview,
        snapshot: sessions[tab.sessionTabId] ?? null,
        tabId: tab.sessionTabId,
        threadRef,
        remember: false,
      });
    }
  }
  state.setEnvironment(input.environmentId);
}

/** The workspace page opens the new tab's session once it shows the tab. */
export function addBrowserWorkspaceTab(): boolean {
  const state = useBrowserWorkspaceStore.getState();
  if (selectBrowserWorkspaceEnvironmentId(state) === null) return false;
  state.addTab({});
  return true;
}

/**
 * Opens the session behind a tab that has none: a new tab, one restored after a restart, or
 * one whose session the server dropped.
 */
export async function openBrowserWorkspaceTabSession<OpenError, CloseError>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly tabId: string;
  readonly openPreview: OpenPreviewMutation<OpenError>;
  readonly closePreview: ClosePreviewMutation<CloseError>;
}): Promise<void> {
  // The page can show a tab before the controller's sync has matched the server's sessions,
  // as right after a reload; opening first would leave the tab's live page to be adopted as
  // a duplicate tab.
  const preview = readThreadPreviewState(input.threadRef);
  if (preview.listLoaded && !isBrowserWorkspaceOpening(useBrowserWorkspaceStore.getState())) {
    useBrowserWorkspaceStore
      .getState()
      .syncSessions({ sessions: preview.sessions, activeSessionTabId: preview.activeTabId });
  }
  const store = useBrowserWorkspaceStore.getState();
  const tab = store.tabs.find((candidate) => candidate.id === input.tabId);
  if (!tab || tab.sessionTabId !== null || store.openStatusByTabId[tab.id] !== undefined) return;
  store.setOpenStatus(tab.id, "opening");
  const result = await openPreviewSession({
    openPreview: input.openPreview,
    threadRef: input.threadRef,
    ...(tab.url === null ? {} : { url: tab.url }),
    ...(tab.profileId === undefined ? {} : { profileId: tab.profileId }),
  });
  const current = useBrowserWorkspaceStore.getState();
  const stillWanted =
    current.environmentId === input.threadRef.environmentId &&
    current.tabs.some((candidate) => candidate.id === tab.id && candidate.sessionTabId === null);
  if (result._tag === "Failure") {
    current.setOpenStatus(
      tab.id,
      isAtomCommandInterrupted(result) || !stillWanted ? null : "failed",
    );
    return;
  }
  if (!stillWanted) {
    // Starting the close drops the session from preview state before the session sync stops
    // waiting on this open, so it cannot adopt the session as a new tab in between.
    const closing = closePreviewSession({
      closePreview: input.closePreview,
      snapshot: result.value,
      tabId: result.value.tabId,
      threadRef: input.threadRef,
      remember: false,
    });
    current.setOpenStatus(tab.id, null);
    await closing;
    return;
  }
  current.attachSession(tab.id, result.value.tabId);
}

/**
 * Closes a workspace tab and its session. `remember: false` is for a tab that moves to a
 * thread, which "reopen closed tab" must not bring back.
 */
export async function closeBrowserWorkspaceTab<E>(input: {
  readonly tabId: string;
  readonly closePreview: ClosePreviewMutation<E>;
  readonly remember?: boolean;
}): Promise<void> {
  const state = useBrowserWorkspaceStore.getState();
  const tab = state.tabs.find((candidate) => candidate.id === input.tabId);
  if (!tab) return;
  if (state.environmentId === null) {
    state.removeTab(tab.id);
    return;
  }
  const threadRef = browserWorkspaceThreadRef(state.environmentId, state.clientId);
  const remember = input.remember !== false;
  const snapshot =
    tab.sessionTabId === null
      ? null
      : (readThreadPreviewState(threadRef).sessions[tab.sessionTabId] ?? null);
  // Started before the tab goes, so the session sync never sees the session without its tab.
  const closing =
    tab.sessionTabId !== null &&
    readEnvironmentScope(threadRef.environmentId, AuthPreviewOperateScope)
      ? closePreviewSession({
          closePreview: input.closePreview,
          snapshot,
          tabId: tab.sessionTabId,
          threadRef,
          remember,
        })
      : null;
  state.removeTab(tab.id);
  await closing;
  if (remember && snapshot === null) rememberDormantTab(threadRef, tab);
}

function rememberDormantTab(threadRef: ScopedThreadRef, tab: BrowserWorkspaceTab): void {
  useClosedViewStore.getState().remember({
    kind: "browser",
    threadRef,
    snapshot: dormantBrowserWorkspaceSnapshot(tab, threadRef.threadId, new Date().toISOString()),
  });
}

/** Moves a thread panel's browser tab into the workspace: same page, same profile, reloaded. */
export async function moveThreadBrowserToWorkspace<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly snapshot: PreviewSessionSnapshot;
  readonly closePreview: ClosePreviewMutation<E>;
}): Promise<boolean> {
  const previousActiveTabId = useBrowserWorkspaceStore.getState().activeTabId;
  const workspaceTabId = reopenInBrowserWorkspace(input.snapshot);
  if (workspaceTabId === null) return false;
  const closed = await closePreviewSession({
    closePreview: input.closePreview,
    snapshot: input.snapshot,
    tabId: input.snapshot.tabId,
    threadRef: input.threadRef,
    remember: false,
  });
  if (closed._tag === "Failure") {
    // The panel keeps the tab, so the workspace must not hold a second copy.
    const store = useBrowserWorkspaceStore.getState();
    store.removeTab(workspaceTabId);
    if (previousActiveTabId !== null) store.activateTab(previousActiveTabId);
    return false;
  }
  const panels = useRightPanelStore.getState();
  const surface = selectThreadPanelBrowserSurface(input.threadRef, input.snapshot.tabId);
  if (surface) panels.closeSurface(input.threadRef, surface.id);
  const next = selectActiveRightPanelSurface(
    useRightPanelStore.getState().byThreadKey,
    input.threadRef,
  );
  if (next?.kind === "preview" && next.resourceId)
    setActivePreviewTab(input.threadRef, next.resourceId);
  return true;
}

function selectThreadPanelBrowserSurface(threadRef: ScopedThreadRef, tabId: string) {
  const { surfaces } = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  );
  return (
    surfaces.find((surface) => surface.kind === "preview" && surface.resourceId === tabId) ?? null
  );
}

/** The thread a workspace tab moves to, if it still exists and can run browser tabs. */
function resolveBrowserWorkspaceMoveTarget(): {
  readonly threadRef: ScopedThreadRef;
  readonly route: ThreadRouteTarget;
} | null {
  const target = useBrowserWorkspaceStore.getState().lastThreadTarget;
  if (!target) return null;
  const resolved = (() => {
    if (target.kind === "server") {
      const threadRef = scopeThreadRef(
        target.environmentId as EnvironmentId,
        ThreadId.make(target.threadId),
      );
      return readThreadShell(threadRef) === null
        ? null
        : { threadRef, route: { kind: "server" as const, threadRef } };
    }
    const draft = useComposerDraftStore.getState().getDraftSession(target.draftId as DraftId);
    if (!draft) return null;
    if (draft.promotedTo) {
      return {
        threadRef: draft.promotedTo,
        route: { kind: "server" as const, threadRef: draft.promotedTo },
      };
    }
    return {
      threadRef: scopeThreadRef(draft.environmentId, draft.threadId),
      route: { kind: "draft" as const, draftId: target.draftId as DraftId },
    };
  })();
  if (
    !resolved ||
    !isPreviewAvailableFor(resolved.threadRef.environmentId) ||
    !readEnvironmentScope(resolved.threadRef.environmentId, AuthPreviewOperateScope)
  ) {
    return null;
  }
  return resolved;
}

/**
 * Moves a workspace tab into the right panel of the thread the user looked at last, and returns
 * where to navigate. `null` means there is no such thread; `"failed"` that the open failed.
 */
export async function moveBrowserWorkspaceTabToThread<OpenError, CloseError>(input: {
  readonly tabId: string;
  readonly openPreview: OpenPreviewMutation<OpenError>;
  readonly closePreview: ClosePreviewMutation<CloseError>;
}): Promise<ThreadRouteTarget | null | "failed"> {
  const state = useBrowserWorkspaceStore.getState();
  const tab = state.tabs.find((candidate) => candidate.id === input.tabId);
  const target = resolveBrowserWorkspaceMoveTarget();
  if (!tab || !target) return null;
  const workspaceRef =
    state.environmentId === null
      ? null
      : browserWorkspaceThreadRef(state.environmentId, state.clientId);
  const snapshot =
    workspaceRef && tab.sessionTabId
      ? readThreadPreviewState(workspaceRef).sessions[tab.sessionTabId]
      : undefined;
  const url =
    snapshot && snapshot.navStatus._tag !== "Idle"
      ? snapshot.navStatus.url
      : (tab.url ?? undefined);
  const profileId = snapshot?.profileId ?? tab.profileId;
  const opened = await openPreviewSession({
    openPreview: input.openPreview,
    threadRef: target.threadRef,
    ...(url === undefined ? {} : { url }),
    ...(snapshot?.viewport === undefined ? {} : { viewport: snapshot.viewport }),
    ...(profileId === undefined ? {} : { profileId }),
  });
  if (opened._tag === "Failure") return isAtomCommandInterrupted(opened) ? null : "failed";
  useRightPanelStore.getState().openBrowser(target.threadRef, opened.value.tabId);
  await closeBrowserWorkspaceTab({
    tabId: tab.id,
    closePreview: input.closePreview,
    remember: false,
  });
  return target.route;
}
