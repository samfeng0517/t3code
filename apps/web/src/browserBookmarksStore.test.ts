import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createJSONStorage } from "zustand/middleware";

import { countBookmarks } from "./browserBookmarks.logic";
import {
  resetBrowserBookmarksForTests,
  syncBrowserBookmarksFromStorage,
  useBrowserBookmarksStore,
} from "./browserBookmarksStore";
import { createMemoryStorage } from "./lib/storage";

const chrome = { sourceId: "chrome", profileId: "Default" };
const nodes = [{ title: "Bookmarks bar", children: [{ title: "A", url: "https://a.test/" }] }];

describe("useBrowserBookmarksStore", () => {
  beforeEach(() => {
    useBrowserBookmarksStore.persist.setOptions({
      storage: createJSONStorage(() => createMemoryStorage()),
    });
    resetBrowserBookmarksForTests();
  });

  it("should keep one imported folder when the same profile is imported twice", () => {
    const store = useBrowserBookmarksStore.getState();
    expect(store.importFolder({ nodes, importSource: chrome, title: "Chrome" })).toEqual({
      ok: true,
      bookmarkCount: 1,
    });
    useBrowserBookmarksStore
      .getState()
      .importFolder({ nodes, importSource: chrome, title: "Chrome" });
    const { bookmarkBar } = useBrowserBookmarksStore.getState();
    expect(bookmarkBar).toHaveLength(1);
    expect(countBookmarks(bookmarkBar)).toBe(1);
  });

  it("should leave bookmarks unchanged and report failure when local storage is full", () => {
    useBrowserBookmarksStore.getState().addBookmark("https://kept.test/", "Kept");
    const full = createMemoryStorage();
    full.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    useBrowserBookmarksStore.persist.setOptions({ storage: createJSONStorage(() => full) });

    const outcome = useBrowserBookmarksStore
      .getState()
      .importFolder({ nodes, importSource: chrome, title: "Chrome" });

    expect(outcome).toEqual({ ok: false });
    expect(useBrowserBookmarksStore.getState().bookmarkBar.map((node) => node.title)).toEqual([
      "Kept",
    ]);
    expect(useBrowserBookmarksStore.getState().addBookmark("https://b.test/", "B")).toBe(
      "storage-full",
    );
  });

  it("should undo only the deleted bookmark when later edits happened", () => {
    const store = () => useBrowserBookmarksStore.getState();
    store().addBookmark("https://a.test/", "A");
    store().addBookmark("https://b.test/", "B");
    const [a, b] = store().bookmarkBar;
    const deletedA = store().removeNode(a!.id);
    store().removeNode(b!.id);
    store().addBookmark("https://c.test/", "C");
    expect(deletedA.ok && deletedA.removed !== null).toBe(true);
    if (deletedA.ok && deletedA.removed)
      expect(store().restoreRemoved(deletedA.removed)).toBe(true);
    expect(store().bookmarkBar.map((node) => node.title)).toEqual(["A", "C"]);
  });

  it("should tell an unsupported page apart from a full storage when bookmarking", () => {
    const store = () => useBrowserBookmarksStore.getState();
    expect(store().addBookmark("about:blank", "Blank")).toBe("unsupported-url");
    expect(store().addBookmark("chrome-extension://abc/page.html", "Ext")).toBe("unsupported-url");
    expect(store().addBookmark(`https://a.test/${"x".repeat(2048)}`, "Long")).toBe(
      "unsupported-url",
    );
    expect(store().addBookmark("https://a.test/", "A")).toBe("saved");
    const full = createMemoryStorage();
    full.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    useBrowserBookmarksStore.persist.setOptions({ storage: createJSONStorage(() => full) });
    expect(store().addBookmark("https://b.test/", "B")).toBe("storage-full");
  });

  it("should pick up bookmarks another window saved when its storage event arrives", async () => {
    const shared = createMemoryStorage();
    useBrowserBookmarksStore.persist.setOptions({ storage: createJSONStorage(() => shared) });
    shared.setItem(
      "t3code:browser-bookmarks:v1",
      JSON.stringify({
        state: {
          bookmarkBar: [{ id: "9", kind: "bookmark", title: "Other", url: "https://other.test/" }],
          other: [],
          nextId: 10,
        },
        version: 1,
      }),
    );
    await syncBrowserBookmarksFromStorage("unrelated-key");
    expect(useBrowserBookmarksStore.getState().bookmarkBar).toEqual([]);
    await syncBrowserBookmarksFromStorage("t3code:browser-bookmarks:v1");
    expect(useBrowserBookmarksStore.getState().bookmarkBar.map((node) => node.title)).toEqual([
      "Other",
    ]);
    expect(useBrowserBookmarksStore.getState().nextId).toBe(10);
  });
});
