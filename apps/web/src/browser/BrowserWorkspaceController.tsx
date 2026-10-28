import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AuthPreviewOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { useBrowserHistoryStore } from "~/browserHistoryStore";
import {
  BROWSER_WORKSPACE_HISTORY_PROJECT_KEY,
  resolveBrowserWorkspaceEnvironmentId,
} from "~/browserWorkspace.logic";
import { isBrowserWorkspaceOpening, useBrowserWorkspaceStore } from "~/browserWorkspaceStore";
import { usePreviewSession } from "~/components/preview/usePreviewSession";
import { environmentCatalog } from "~/connection/catalog";
import { useThreadRouteTarget } from "~/hooks/useThreadRouteTarget";
import { isPreviewSupportedInRuntime, useThreadPreviewState } from "~/previewStateStore";
import { useServerConfigs } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { setBrowserWorkspaceEnvironment } from "./browserWorkspaceActions";
import { useBrowserWorkspaceThreadRef } from "./useBrowserWorkspace";

/**
 * Keeps the browser workspace bound to a real environment, its tabs bound to live sessions,
 * and remembers which thread a workspace tab would move to. Mounted once in the app shell, so
 * this runs whether or not the workspace page is showing.
 */
export function BrowserWorkspaceController() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const serverConfigs = useServerConfigs();
  const environmentId = resolveBrowserWorkspaceEnvironmentId({
    primaryEnvironmentId,
    environmentIds: [...catalog.entries.keys()],
    previewInRuntime: isPreviewSupportedInRuntime(),
    supportsServerBrowser: (id) =>
      serverConfigs.get(id)?.environment.capabilities.serverBrowser === true,
  });
  const closePreview = useAtomCommand(previewEnvironment.close, { reportFailure: false });
  // oxlint-disable-next-line t3code/react-effect-budget -- hands the preview close command to the external workspace store
  useEffect(() => {
    setBrowserWorkspaceEnvironment({ environmentId, closePreview });
  }, [closePreview, environmentId]);

  const routeTarget = useThreadRouteTarget();
  const routeKind = routeTarget?.kind ?? null;
  const routeEnvironmentId =
    routeTarget?.kind === "server" ? routeTarget.threadRef.environmentId : null;
  const routeThreadId = routeTarget?.kind === "server" ? routeTarget.threadRef.threadId : null;
  const routeDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  // oxlint-disable-next-line t3code/react-effect-budget -- mirrors the route target into the external workspace store
  useEffect(() => {
    const store = useBrowserWorkspaceStore.getState();
    if (routeKind === "server" && routeEnvironmentId && routeThreadId) {
      store.setLastThreadTarget({
        kind: "server",
        environmentId: routeEnvironmentId,
        threadId: routeThreadId,
      });
    } else if (routeKind === "draft" && routeDraftId) {
      store.setLastThreadTarget({ kind: "draft", draftId: routeDraftId });
    }
  }, [routeDraftId, routeEnvironmentId, routeKind, routeThreadId]);

  const threadRef = useBrowserWorkspaceThreadRef();
  const canOperatePreview = useEnvironmentScope(
    threadRef?.environmentId ?? null,
    AuthPreviewOperateScope,
  );
  return threadRef && canOperatePreview ? (
    <BrowserWorkspaceSessionSync threadRef={threadRef} />
  ) : null;
}

function BrowserWorkspaceSessionSync({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  usePreviewSession(threadRef);
  const { environmentId, threadId } = threadRef;
  const previewState = useThreadPreviewState(threadRef);
  const { sessions, listLoaded } = previewState;
  const activeSessionTabId = previewState.activeTabId;
  const opening = useBrowserWorkspaceStore(isBrowserWorkspaceOpening);

  // oxlint-disable-next-line t3code/react-effect-budget -- registers the thread's history project in the external history store
  useEffect(() => {
    useBrowserHistoryStore
      .getState()
      .registerThreadProject(
        scopeThreadRef(environmentId, threadId),
        BROWSER_WORKSPACE_HISTORY_PROJECT_KEY,
      );
  }, [environmentId, threadId]);

  // oxlint-disable-next-line t3code/react-effect-budget -- mirrors preview sessions into the external browser workspace store
  useEffect(() => {
    if (!listLoaded || opening) return;
    useBrowserWorkspaceStore.getState().syncSessions({ sessions, activeSessionTabId });
  }, [activeSessionTabId, listLoaded, opening, sessions]);

  return null;
}
