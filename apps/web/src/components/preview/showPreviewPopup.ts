import type { ScopedThreadRef } from "@t3tools/contracts";

import { isBrowserWorkspaceThreadRef } from "~/browserWorkspace.logic";
import { useBrowserWorkspaceStore } from "~/browserWorkspaceStore";
import { browserMiniPlayerSource, usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { whenPreviewTabKnown } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";

export function showPreviewPopup(
  threadRef: ScopedThreadRef,
  popupTabId: string,
  from: "panel" | "floating",
): void {
  // The workspace has no panel; its session sync turns the popup into the tab shown.
  if (isBrowserWorkspaceThreadRef(threadRef)) {
    useBrowserWorkspaceStore.getState().showSession(popupTabId);
    return;
  }
  whenPreviewTabKnown(threadRef, popupTabId, () => {
    if (from === "floating") {
      usePreviewMiniPlayerStore.getState().open(threadRef, browserMiniPlayerSource(popupTabId));
    } else {
      useRightPanelStore.getState().openBrowser(threadRef, popupTabId);
    }
  });
}
