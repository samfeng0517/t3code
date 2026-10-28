import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AuthPreviewOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { Globe2Icon } from "lucide-react";
import { useEffect, useEffectEvent } from "react";

import { openBrowserWorkspaceTabSession } from "~/browser/browserWorkspaceActions";
import {
  useBrowserWorkspaceCommands,
  useBrowserWorkspaceThreadRef,
} from "~/browser/useBrowserWorkspace";
import type { BrowserWorkspaceTab } from "~/browserWorkspace.logic";
import { selectActiveBrowserWorkspaceTab, useBrowserWorkspaceStore } from "~/browserWorkspaceStore";
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { isElectron } from "~/env";
import { useT } from "~/i18n";
import { resolveShortcutCommand } from "~/keybindings";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { useThreadPreviewState } from "~/previewStateStore";
import { useEnvironmentSupportsServerBrowser } from "~/state/entities";
import { previewEnvironment } from "~/state/preview";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { hostOf } from "../sidebar/sidebarBrowserTabs.logic";
import { PreviewPanel } from "./PreviewPanel";

function getShortcutContext() {
  return {
    terminalFocus: isTerminalFocused(),
    terminalOpen: false,
    previewFocus: false,
    previewOpen: true,
    modelPickerOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
  };
}

/**
 * The browser workspace: the current workspace tab filling everything beside the sidebar.
 * The sidebar's Browser section is its tab strip.
 */
export function BrowserWorkspacePage() {
  const t = useT();
  const threadRef = useBrowserWorkspaceThreadRef();
  const activeTab = useBrowserWorkspaceStore(selectActiveBrowserWorkspaceTab);
  const commands = useBrowserWorkspaceCommands();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  // The shortcut that closes a thread's panel tab closes the workspace tab here. Handling it
  // also keeps Electron's window-close menu role from closing the whole window.
  const closeActiveTabFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (activeTab === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) commands.closeTab(activeTab.id);
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- subscribes to document keydown for the close shortcut and unsubscribes on cleanup
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: getShortcutContext(),
      });
      if (command === "rightPanel.close") closeActiveTabFromShortcut(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [keybindings]);
  const previewState = useThreadPreviewState(threadRef);
  const session = activeTab?.sessionTabId
    ? previewState.sessions[activeTab.sessionTabId]
    : undefined;
  const loaded = session && session.navStatus._tag !== "Idle" ? session.navStatus : null;
  const url = loaded?.url ?? activeTab?.url ?? null;
  const title =
    activeTab?.customTitle ||
    (loaded ? loaded.title.trim() : activeTab?.title) ||
    (url ? hostOf(url) : null) ||
    (activeTab ? t("browser.sidebar.blankTab") : t("browser.sidebar.section"));

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="min-w-0 truncate text-sm font-medium text-foreground">{title}</h1>
        </WorkspacePageHeader>
        {threadRef === null ? (
          <WorkspaceMessage
            title={t("browser.sidebar.section")}
            description={t("workspace.preview.unavailable.desktopOnly")}
          />
        ) : activeTab === null ? (
          <NoWorkspaceTabs />
        ) : (
          <BrowserWorkspaceTabView key={activeTab.id} threadRef={threadRef} tab={activeTab} />
        )}
      </div>
    </SidebarInset>
  );
}

function BrowserWorkspaceTabView(props: {
  readonly threadRef: ScopedThreadRef;
  readonly tab: BrowserWorkspaceTab;
}) {
  const t = useT();
  const { threadRef, tab } = props;
  const { environmentId, threadId } = threadRef;
  const previewState = useThreadPreviewState(threadRef);
  const status = useBrowserWorkspaceStore((state) => state.openStatusByTabId[tab.id]);
  const serverBrowser = useEnvironmentSupportsServerBrowser(environmentId);
  const canOperatePreview = useEnvironmentScope(environmentId, AuthPreviewOperateScope);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  const session = tab.sessionTabId === null ? undefined : previewState.sessions[tab.sessionTabId];
  // Like a thread's panel, wait for the server's list so a stale one cannot drop the new tab.
  const sessionsReady = !serverBrowser || previewState.listLoaded;
  const needsSession = tab.sessionTabId === null && status === undefined;

  // oxlint-disable-next-line t3code/react-effect-budget -- opens the preview session over IPC when a tab needs one, an external side effect
  useEffect(() => {
    if (!needsSession || !sessionsReady || !canOperatePreview) return;
    void openBrowserWorkspaceTabSession({
      threadRef: scopeThreadRef(environmentId, threadId),
      tabId: tab.id,
      openPreview,
      closePreview,
    });
  }, [
    canOperatePreview,
    closePreview,
    environmentId,
    needsSession,
    openPreview,
    sessionsReady,
    tab.id,
    threadId,
  ]);

  if (session || !canOperatePreview) {
    return (
      <PreviewPanel
        mode="embedded"
        threadRef={threadRef}
        tabId={session?.tabId ?? null}
        visible
        variant="workspace"
      />
    );
  }
  if (status === "failed") {
    return (
      <WorkspaceMessage title={t("browser.workspace.openFailed")}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => useBrowserWorkspaceStore.getState().setOpenStatus(tab.id, null)}
        >
          {t("browser.workspace.retry")}
        </Button>
      </WorkspaceMessage>
    );
  }
  // The session is a round trip away; an empty page reads better than a flash of a spinner.
  return <div className="min-h-0 flex-1" />;
}

function NoWorkspaceTabs() {
  const t = useT();
  const commands = useBrowserWorkspaceCommands();
  return (
    <WorkspaceMessage
      title={t("browser.workspace.empty.title")}
      description={t("browser.workspace.empty.description")}
    >
      <Button variant="outline" size="sm" onClick={commands.newTab}>
        {t("browser.sidebar.newTab")}
      </Button>
    </WorkspaceMessage>
  );
}

function WorkspaceMessage(props: {
  readonly title: string;
  readonly description?: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Globe2Icon />
        </EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        {props.description ? <EmptyDescription>{props.description}</EmptyDescription> : null}
      </EmptyHeader>
      {props.children}
    </Empty>
  );
}
