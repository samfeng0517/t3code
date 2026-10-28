import type { BrowserBookmarkNode } from "~/browserBookmarks.logic";
import { useBrowserBookmarksStore } from "~/browserBookmarksStore";
import { t as getMessage } from "~/i18n";

import { toastManager } from "../ui/toast";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function bookmarkDisplayTitle(node: BrowserBookmarkNode): string {
  if (node.kind === "folder") {
    const title = node.title || getMessage("browser.bookmarks.untitled");
    return node.importSource
      ? getMessage("browser.bookmarks.importedFolder", { source: title })
      : title;
  }
  return node.title || hostOf(node.url);
}

function reportSaveFailed(reason: "storage-full" | "unsupported-url" = "storage-full"): void {
  toastManager.add({
    type: "error",
    title: getMessage("browser.bookmarks.saveFailed"),
    description: getMessage(
      reason === "unsupported-url"
        ? "browser.bookmarks.unsupportedUrl"
        : "browser.bookmarks.storageFull",
    ),
  });
}

/** The address bar star: bookmarks the page on the bookmarks bar, or removes every copy. */
export function toggleBookmarkForUrl(input: {
  readonly url: string;
  readonly title: string;
  readonly bookmarked: boolean;
}): void {
  const store = useBrowserBookmarksStore.getState();
  if (input.bookmarked) {
    if (!store.removeBookmarksForUrl(input.url)) reportSaveFailed();
    return;
  }
  const result = store.addBookmark(input.url, input.title);
  if (result !== "saved") reportSaveFailed(result);
}

/** Deleting a folder can drop hundreds of bookmarks at once, so it always offers an undo. */
export function deleteBookmarkWithUndo(node: BrowserBookmarkNode): void {
  const removal = useBrowserBookmarksStore.getState().removeNode(node.id);
  if (!removal.ok) {
    reportSaveFailed();
    return;
  }
  const { removed } = removal;
  if (removed === null) return;
  const toastId = toastManager.add({
    type: "success",
    title: getMessage("browser.bookmarks.deleted", { title: bookmarkDisplayTitle(node) }),
    actionProps: {
      children: getMessage("browser.newTab.undo"),
      onClick: () => {
        toastManager.close(toastId);
        if (!useBrowserBookmarksStore.getState().restoreRemoved(removed)) reportSaveFailed();
      },
    },
  });
}
