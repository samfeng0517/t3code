import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { browserWorkspaceThreadRef } from "~/browserWorkspace.logic";
import {
  reopenInBrowserWorkspace,
  selectBrowserWorkspaceEnvironmentId,
  useBrowserWorkspaceStore,
} from "~/browserWorkspaceStore";
import { type ClosedViewEntry, useClosedViewStore } from "~/closedViewStore";
import { toastManager } from "~/components/ui/toast";
import { useT } from "~/i18n";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "~/threadRoutes";

import {
  addBrowserWorkspaceTab,
  closeBrowserWorkspaceTab,
  moveBrowserWorkspaceTabToThread,
  moveThreadBrowserToWorkspace,
} from "./browserWorkspaceActions";

export function useBrowserWorkspaceThreadRef(): ScopedThreadRef | null {
  const environmentId = useBrowserWorkspaceStore(selectBrowserWorkspaceEnvironmentId);
  const clientId = useBrowserWorkspaceStore((state) => state.clientId);
  return environmentId === null ? null : browserWorkspaceThreadRef(environmentId, clientId);
}

/** What the sidebar, palette, shortcuts and browser menus do to workspace tabs. */
export function useBrowserWorkspaceCommands() {
  const t = useT();
  const navigate = useNavigate();
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  const showWorkspace = () => navigate({ to: "/browser" });
  const reportMoveFailure = () =>
    toastManager.add({ type: "error", title: t("browser.workspace.moveFailed") });

  return {
    newTab: () => {
      if (addBrowserWorkspaceTab()) void showWorkspace();
    },
    showTab: (tabId: string) => {
      useBrowserWorkspaceStore.getState().activateTab(tabId);
      void showWorkspace();
    },
    /** Pinned tabs stay until they are unpinned; moving one to a thread still works. */
    closeTab: (tabId: string) => {
      const tab = useBrowserWorkspaceStore
        .getState()
        .tabs.find((candidate) => candidate.id === tabId);
      if (!tab || tab.pinned) return;
      void closeBrowserWorkspaceTab({ tabId, closePreview });
    },
    reopenClosed: (entry: ClosedViewEntry) => {
      if (entry.kind !== "browser" || reopenInBrowserWorkspace(entry.snapshot) === null) return;
      useClosedViewStore.getState().remove(entry.id);
      void showWorkspace();
    },
    moveToWorkspace: async (threadRef: ScopedThreadRef, snapshot: PreviewSessionSnapshot) => {
      if (await moveThreadBrowserToWorkspace({ threadRef, snapshot, closePreview })) {
        await showWorkspace();
        return;
      }
      reportMoveFailure();
    },
    moveToThread: async (tabId: string) => {
      const route = await moveBrowserWorkspaceTabToThread({ tabId, openPreview, closePreview });
      if (route === null) {
        toastManager.add({ type: "error", title: t("browser.workspace.noRecentThread") });
      } else if (route === "failed") {
        reportMoveFailure();
      } else if (route.kind === "server") {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(route.threadRef),
        });
      } else {
        await navigate({
          to: "/draft/$draftId",
          params: buildDraftThreadRouteParams(route.draftId),
        });
      }
    },
  };
}

export interface BrowserTabTransfer {
  readonly label: string;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}

/**
 * The browser menu's move between a thread's panel and the workspace. A panel tab offers the
 * workspace while one is available; a workspace tab offers the thread the user looked at last.
 */
export function useBrowserTabTransfer(input: {
  readonly variant: "thread" | "workspace";
  readonly threadRef: ScopedThreadRef;
  readonly snapshot: PreviewSessionSnapshot | null;
}): BrowserTabTransfer | null {
  const t = useT();
  const commands = useBrowserWorkspaceCommands();
  const workspaceAvailable = useBrowserWorkspaceStore(
    (state) => selectBrowserWorkspaceEnvironmentId(state) !== null,
  );
  const hasMoveTarget = useBrowserWorkspaceStore((state) => state.lastThreadTarget !== null);
  const sessionTabId = input.snapshot?.tabId ?? null;
  const workspaceTabId = useBrowserWorkspaceStore((state) =>
    input.variant === "workspace" && sessionTabId !== null
      ? (state.tabs.find((tab) => tab.sessionTabId === sessionTabId)?.id ?? null)
      : null,
  );
  const { snapshot, threadRef } = input;
  if (input.variant === "workspace") {
    if (workspaceTabId === null) return null;
    return {
      label: t("browser.workspace.moveToThread"),
      disabled: !hasMoveTarget,
      onSelect: () => void commands.moveToThread(workspaceTabId),
    };
  }
  if (!workspaceAvailable || snapshot === null) return null;
  return {
    label: t("browser.workspace.moveToWorkspace"),
    disabled: false,
    onSelect: () => void commands.moveToWorkspace(threadRef, snapshot),
  };
}
