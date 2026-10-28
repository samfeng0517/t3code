import { AuthPreviewOperateScope, type EnvironmentId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { addBrowserWorkspaceTab } from "../browser/browserWorkspaceActions";
import { isPreviewAvailableFor } from "../browser/previewRuntime";
import {
  selectBrowserWorkspaceEnvironmentId,
  useBrowserWorkspaceStore,
} from "../browserWorkspaceStore";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { useComposerDraftStore } from "../composerDraftStore";
import { t } from "../i18n";
import { dispatchPreviewAction, type PreviewAction } from "../components/preview/previewActionBus";
import { isAppModalPage } from "../components/sidebar/mainAppLocation";
import { createNewThreadHandler, resolveDefaultProjectRef } from "../hooks/useHandleNewThread";
import { createScratchProjectActions } from "../hooks/useScratchProject";
import { getClientSettings } from "../hooks/useSettings";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { readProjects, readThreadShell } from "../state/entities";
import { environmentPresentations } from "../state/presentation";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { readEnvironmentScope } from "../state/session";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import { type CommandHandler, registerCommands } from "./dispatcher";

const CHAT_ROUTE_ID = "/_chat";

/**
 * New-thread and preview commands, live while a chat route is showing and no
 * modal page (Settings, Usage) covers it. Everything is read at event time, so
 * the scope is registered once instead of re-registering on every store change.
 */
export function installChatRouteCommands(router: AnyRouter): () => void {
  const handleNewThread = createNewThreadHandler(router);
  const scratch = createScratchProjectActions({
    environments: () =>
      [...appAtomRegistry.get(environmentPresentations.presentationsAtom)].map(
        ([environmentId, presentation]) => ({ ...presentation, environmentId }),
      ),
    primaryEnvironmentId: () => appAtomRegistry.get(primaryEnvironmentIdAtom),
    registry: appAtomRegistry,
    handleNewThread,
  });

  const readRouteTarget = () => resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const readRouteThreadRef = () => {
    const target = readRouteTarget();
    return target?.kind === "server" ? target.threadRef : null;
  };
  const readPreviewOpen = () => {
    const threadRef = readRouteThreadRef();
    // Store-only on purpose: the URL-aware arbitration lives in ChatView's
    // preview toggle, which the action bus reaches.
    return threadRef
      ? selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef) === "preview"
      : false;
  };
  const readThreadContext = () => {
    const target = readRouteTarget();
    const drafts = useComposerDraftStore.getState();
    const activeThread = target?.kind === "server" ? readThreadShell(target.threadRef) : null;
    const activeDraftThread = target
      ? target.kind === "server"
        ? drafts.getDraftThread(target.threadRef)
        : drafts.getDraftSession(target.draftId)
      : null;
    return {
      activeDraftThread,
      activeThread: activeThread ?? undefined,
      defaultProjectRef: resolveDefaultProjectRef(
        readProjects(),
        useUiStateStore.getState().projectOrder,
      ),
      handleNewThread,
    };
  };
  const readProjectGroupCount = () =>
    buildSidebarProjectSnapshots({
      projects: readProjects(),
      settings: selectProjectGroupingSettings(getClientSettings()),
      primaryEnvironmentId: appAtomRegistry.get(primaryEnvironmentIdAtom),
      resolveEnvironmentLabel: () => null,
    }).length;
  const canOperatePreview = (environmentId: EnvironmentId) =>
    readEnvironmentScope(environmentId, AuthPreviewOperateScope);
  const readBrowserWorkspaceEnvironmentId = () =>
    selectBrowserWorkspaceEnvironmentId(useBrowserWorkspaceStore.getState());
  // The workspace page's browser takes the page-level preview shortcuts (refresh, zoom, ...).
  const readPreviewEnvironmentId = () =>
    readRouteThreadRef()?.environmentId ??
    (router.state.location.pathname === "/browser" ? readBrowserWorkspaceEnvironmentId() : null);

  const claim = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const startNewLocal: CommandHandler = (event) => {
    claim(event);
    void startNewThreadFromContext(readThreadContext());
  };

  const previewCommand =
    (action: PreviewAction): CommandHandler =>
    (event) => {
      claim(event);
      const environmentId = readPreviewEnvironmentId();
      if (environmentId && canOperatePreview(environmentId)) dispatchPreviewAction(action);
    };

  const togglePreview =
    (newTab: boolean): CommandHandler =>
    (event) => {
      claim(event);
      // Without a thread on screen a new tab has no panel to open in, so it opens in the workspace.
      if (newTab && readRouteTarget() === null) {
        const workspaceEnvironmentId = readBrowserWorkspaceEnvironmentId();
        if (workspaceEnvironmentId !== null && canOperatePreview(workspaceEnvironmentId)) {
          if (addBrowserWorkspaceTab()) void router.navigate({ to: "/browser" });
        }
        return;
      }
      const threadRef = readRouteThreadRef();
      if (
        !threadRef ||
        (!canOperatePreview(threadRef.environmentId) && (newTab || !readPreviewOpen()))
      ) {
        return;
      }
      if (!isPreviewAvailableFor(threadRef.environmentId)) {
        toastManager.add(
          stackedThreadToast({
            type: "info",
            title: t("onboarding.route.previewDesktopOnly.title"),
            description: t("onboarding.route.previewDesktopOnly.description"),
          }),
        );
        return;
      }
      dispatchPreviewAction(newTab ? "new-tab" : "toggle-panel");
    };

  return registerCommands(
    {
      "chat.newLocal": startNewLocal,
      "chat.newWithoutProject": (event) => {
        const { activeThread, activeDraftThread } = readThreadContext();
        const environmentId = scratch.scratchEnvironmentId(
          activeThread?.environmentId ?? activeDraftThread?.environmentId ?? null,
        );
        if (environmentId === null) return;
        claim(event);
        void scratch.startScratchThread(environmentId);
      },
      "chat.new": (event) => {
        // Pre-hydration settings are the defaults, where the legacy sidebar is off.
        if (!getClientSettings().legacySidebarEnabled && readProjectGroupCount() > 1) {
          claim(event);
          openCommandPalette({ open: "new-thread-in" });
          return;
        }
        startNewLocal(event);
      },
      "preview.toggle": togglePreview(false),
      "preview.newTab": togglePreview(true),
      "preview.refresh": previewCommand("refresh"),
      "preview.focusUrl": previewCommand("focus-url"),
      "preview.zoomIn": previewCommand("zoom-in"),
      "preview.zoomOut": previewCommand("zoom-out"),
      "preview.resetZoom": previewCommand("reset-zoom"),
    },
    {
      when: () =>
        router.state.matches.some((match) => match.routeId === CHAT_ROUTE_ID) &&
        !router.state.matches.some((match) => isAppModalPage(match.pathname)) &&
        !isCommandPaletteOpen(),
      context: () => {
        const threadRef = readRouteThreadRef();
        return {
          terminalOpen: threadRef
            ? selectThreadTerminalUiState(
                useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
                threadRef,
              ).terminalOpen
            : false,
          previewOpen: readPreviewOpen(),
        };
      },
      onKeyDown: (event) => {
        if (event.key !== "Escape") return false;
        const selection = useThreadSelectionStore.getState();
        if (selection.selectedThreadKeys.size === 0) return false;
        event.preventDefault();
        selection.clearSelection();
      },
    },
  );
}
