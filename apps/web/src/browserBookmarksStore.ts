import type { BrowserBookmarkTreeNode } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";

import {
  addBookmark,
  addBookmarkFolder,
  type BookmarkDestination,
  type BrowserBookmarkImportSource,
  type BrowserBookmarkNode,
  type BrowserBookmarkRoots,
  buildImportedFolder,
  dissolveBookmarkFolder,
  isUrlBookmarked,
  moveBookmarkNode,
  normalizeBookmarkUrl,
  type RemovedBookmark,
  removeBookmarkNodeWithLocation,
  removeBookmarksForUrl,
  replaceImportedFolder,
  restoreRemovedBookmark,
  sanitizePersistedBookmarks,
  updateBookmarkNode,
} from "./browserBookmarks.logic";
import { resolveStorage } from "./lib/storage";

const BROWSER_BOOKMARKS_STORAGE_KEY = "t3code:browser-bookmarks:v1";

/** `unsupported-url`: a page the in-app browser cannot reopen, such as `about:blank`. */
export type BrowserBookmarkSaveResult = "saved" | "unsupported-url" | "storage-full";

export type BrowserBookmarkRemoval =
  | { readonly ok: true; readonly removed: RemovedBookmark | null }
  | { readonly ok: false };

/**
 * Undoing a dissolve puts `before` back only while the bookmarks are still exactly `after`;
 * a reload from another window's write counts as a change.
 */
export interface BrowserBookmarkSnapshot {
  readonly before: BrowserBookmarkRoots;
  readonly after: BrowserBookmarkRoots;
}

export type BrowserBookmarkImportOutcome =
  | { readonly ok: true; readonly bookmarkCount: number }
  | { readonly ok: false };

interface BrowserBookmarksStoreState extends BrowserBookmarkRoots {
  nextId: number;
  /** Adds the page to the end of the bookmarks bar. */
  addBookmark: (url: string, title: string) => BrowserBookmarkSaveResult;
  removeBookmarksForUrl: (url: string) => boolean;
  removeNode: (id: string) => BrowserBookmarkRemoval;
  /** Undoes one `removeNode`, touching nothing else. */
  restoreRemoved: (removed: RemovedBookmark) => boolean;
  /** Returns false only when storage is full; an impossible move changes nothing. */
  moveNode: (id: string, destination: BookmarkDestination) => boolean;
  updateNode: (
    id: string,
    patch: { readonly title: string; readonly url?: string },
  ) => BrowserBookmarkSaveResult;
  /** The new folder's id, or null when storage is full. */
  addFolder: (destination: BookmarkDestination, title: string) => string | null;
  /** A null snapshot means the folder was already gone, so nothing changed. */
  dissolveFolder: (
    id: string,
  ) =>
    | { readonly ok: true; readonly snapshot: BrowserBookmarkSnapshot | null }
    | { readonly ok: false };
  restoreSnapshot: (snapshot: BrowserBookmarkSnapshot) => "restored" | "changed" | "storage-full";
  importFolder: (input: {
    readonly nodes: ReadonlyArray<BrowserBookmarkTreeNode>;
    readonly importSource: BrowserBookmarkImportSource;
    readonly title: string;
  }) => BrowserBookmarkImportOutcome;
}

type PersistedBookmarks = Pick<BrowserBookmarksStoreState, "bookmarkBar" | "other" | "nextId">;

export const useBrowserBookmarksStore = create<BrowserBookmarksStoreState>()(
  persist(
    (set, get) => {
      // The persist middleware writes inside `set`, so a full local storage throws from it. Keep
      // memory and disk in step by putting the previous bookmarks back, and tell the caller.
      const commit = (next: Partial<PersistedBookmarks>): boolean => {
        const { bookmarkBar, other, nextId } = get();
        try {
          set(next);
          return true;
        } catch {
          try {
            set({ bookmarkBar, other, nextId });
          } catch {}
          return false;
        }
      };
      return {
        bookmarkBar: [],
        other: [],
        nextId: 1,
        addBookmark: (url, title) => {
          const normalized = normalizeBookmarkUrl(url);
          if (normalized === null) return "unsupported-url";
          const state = get();
          const node: BrowserBookmarkNode = {
            id: String(state.nextId),
            kind: "bookmark",
            title: title.trim().slice(0, 512),
            url: normalized,
          };
          return commit({ ...addBookmark(state, node), nextId: state.nextId + 1 })
            ? "saved"
            : "storage-full";
        },
        removeBookmarksForUrl: (url) => {
          const state = get();
          const next = removeBookmarksForUrl(state, url);
          return next === state ? true : commit(next);
        },
        removeNode: (id) => {
          const { roots, removed } = removeBookmarkNodeWithLocation(get(), id);
          if (removed === null) return { ok: true, removed };
          return commit(roots) ? { ok: true, removed } : { ok: false };
        },
        restoreRemoved: (removed) => {
          const state = get();
          const next = restoreRemovedBookmark(selectBookmarkRoots(state), removed);
          return next.bookmarkBar === state.bookmarkBar && next.other === state.other
            ? true
            : commit(next);
        },
        moveNode: (id, destination) => {
          const state = get();
          const roots = selectBookmarkRoots(state);
          const next = moveBookmarkNode(roots, id, destination);
          return next === roots ? true : commit(next);
        },
        updateNode: (id, patch) => {
          const next = updateBookmarkNode(selectBookmarkRoots(get()), id, patch);
          if (next === "unsupported-url") return next;
          return commit(next) ? "saved" : "storage-full";
        },
        addFolder: (destination, title) => {
          const state = get();
          const id = String(state.nextId);
          const next = addBookmarkFolder(selectBookmarkRoots(state), destination, { id, title });
          return commit({ ...next, nextId: state.nextId + 1 }) ? id : null;
        },
        dissolveFolder: (id) => {
          const before = selectBookmarkRoots(get());
          const after = dissolveBookmarkFolder(before, id);
          if (after === before) return { ok: true, snapshot: null };
          return commit(after) ? { ok: true, snapshot: { before, after } } : { ok: false };
        },
        restoreSnapshot: ({ before, after }) => {
          const state = get();
          if (state.bookmarkBar !== after.bookmarkBar || state.other !== after.other) {
            return "changed";
          }
          return commit(before) ? "restored" : "storage-full";
        },
        importFolder: (input) => {
          const state = get();
          const { folder, nextId, bookmarkCount } = buildImportedFolder({
            ...input,
            nextId: state.nextId,
          });
          return commit({ ...replaceImportedFolder(state, folder), nextId })
            ? { ok: true, bookmarkCount }
            : { ok: false };
        },
      };
    },
    {
      name: BROWSER_BOOKMARKS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state): PersistedBookmarks => ({
        bookmarkBar: state.bookmarkBar,
        other: state.other,
        nextId: state.nextId,
      }),
      merge: (persistedState, currentState) => {
        const { roots, nextId } = sanitizePersistedBookmarks(persistedState);
        return { ...currentState, ...roots, nextId };
      },
    },
  ),
);

/**
 * Another window wrote the bookmarks; reload them so this window's next write does not save
 * its stale copy over that change.
 */
export function syncBrowserBookmarksFromStorage(key: string | null): Promise<void> | void {
  if (key !== BROWSER_BOOKMARKS_STORAGE_KEY && key !== null) return undefined;
  return useBrowserBookmarksStore.persist.rehydrate();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => void syncBrowserBookmarksFromStorage(event.key));
}

function selectBookmarkRoots(state: BrowserBookmarksStoreState): BrowserBookmarkRoots {
  return { bookmarkBar: state.bookmarkBar, other: state.other };
}

export function useBookmarkRoots(): BrowserBookmarkRoots {
  return useBrowserBookmarksStore(useShallow(selectBookmarkRoots));
}

export function useIsUrlBookmarked(url: string | null): boolean {
  return useBrowserBookmarksStore((state) =>
    url === null ? false : isUrlBookmarked(selectBookmarkRoots(state), url),
  );
}

export function resetBrowserBookmarksForTests(): void {
  useBrowserBookmarksStore.setState({ bookmarkBar: [], other: [], nextId: 1 });
  useBrowserBookmarksStore.persist.clearStorage();
}
