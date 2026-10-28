import { describe, expect, it } from "vite-plus/test";

import {
  addBookmark,
  addBookmarkFolder,
  bookmarkFileImport,
  bookmarkedUrls,
  type BrowserBookmarkNode,
  type BrowserBookmarkRoots,
  buildImportedFolder,
  countBookmarks,
  dissolveBookmarkFolder,
  EMPTY_BOOKMARK_ROOTS,
  moveBookmarkNode,
  parseNetscapeBookmarksHtml,
  removeBookmarkNode,
  removeBookmarkNodeWithLocation,
  removeBookmarksForUrl,
  replaceImportedFolder,
  resolveBookmarkDrop,
  restoreRemovedBookmark,
  sanitizePersistedBookmarks,
  updateBookmarkNode,
} from "./browserBookmarks.logic";

// What Chrome's bookmark manager writes from "Export bookmarks": unclosed <DT> and <p> tags,
// upper-case tags, entity-encoded titles, and loose bookmarks after the bar folder.
const CHROME_EXPORT_FIXTURE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000001" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://t3.codes/" ADD_DATE="1700000000" ICON="data:image/png;base64,AAAA">T3 Code</A>
        <DT><H3 ADD_DATE="1700000000">Docs &amp; Notes</H3>
        <DL><p>
            <DT><A HREF="https://effect.website/docs?a=1&amp;b=2">Effect &lt;docs&gt;</A>
            <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
        </DL><p>
        <DT><H3>Empty</H3>
        <DL><p>
        </DL><p>
    </DL><p>
    <DT><A HREF='http://localhost:3000/'>Local &#39;app&#39;</A>
</DL><p>
`;

describe("parseNetscapeBookmarksHtml", () => {
  it("should keep folders and web bookmarks when parsing a Chrome export", () => {
    expect(parseNetscapeBookmarksHtml(CHROME_EXPORT_FIXTURE)).toEqual([
      {
        title: "Bookmarks bar",
        children: [
          { title: "T3 Code", url: "https://t3.codes/" },
          {
            title: "Docs & Notes",
            children: [{ title: "Effect <docs>", url: "https://effect.website/docs?a=1&b=2" }],
          },
          { title: "Empty", children: [] },
        ],
      },
      { title: "Local 'app'", url: "http://localhost:3000/" },
    ]);
  });

  it("should keep a bookmark that follows a stray less-than sign", () => {
    expect(
      parseNetscapeBookmarksHtml(`<DL><DT>Notes < more <A HREF="https://a.test/">A</A></DL>`),
    ).toEqual([{ title: "A", url: "https://a.test/" }]);
  });

  it("should parse correctly when the file holds thousands of unclosed tags", () => {
    const html = `${"<a".repeat(20_000)}<DL><DT><A HREF="https://a.test/">A</A></DL>`;
    expect(parseNetscapeBookmarksHtml(html)).toEqual([{ title: "A", url: "https://a.test/" }]);
  });

  it("should keep later bookmarks at their own level when folders nest deeper than the limit", () => {
    const deepOpen = "<DT><H3>N</H3><DL>".repeat(40);
    const deepClose = "</DL>".repeat(40);
    const html = `<DL><DT><H3>F1</H3><DL>${deepOpen}${deepClose}<DT><A HREF="https://in-f1.test/">In F1</A></DL><DT><A HREF="https://top.test/">Top</A></DL></DL></DL>`;
    const parsed = parseNetscapeBookmarksHtml(html);
    expect(parsed.map((node) => node.title)).toEqual(["F1", "Top"]);
    expect(parsed[0]?.children?.at(-1)).toEqual({ title: "In F1", url: "https://in-f1.test/" });
  });

  it("should return nothing when the file is not a bookmarks export", () => {
    expect(parseNetscapeBookmarksHtml("<html><body>hello</body></html>")).toEqual([]);
    expect(parseNetscapeBookmarksHtml("")).toEqual([]);
  });
});

const chromeSource = { sourceId: "chrome", profileId: "Default" };

function importChrome(roots: BrowserBookmarkRoots, nextId: number, title: string) {
  const imported = buildImportedFolder({
    nodes: [{ title: "Bookmarks bar", children: [{ title, url: "https://a.test/" }] }],
    importSource: chromeSource,
    title: "Chrome",
    nextId,
  });
  return { roots: replaceImportedFolder(roots, imported.folder), nextId: imported.nextId };
}

describe("buildImportedFolder", () => {
  it("should assign unique ids and count bookmarks when building an imported folder", () => {
    const { folder, nextId, bookmarkCount } = buildImportedFolder({
      nodes: [
        { title: "Bar", children: [{ title: "A", url: "https://a.test" }] },
        { title: "B", url: "https://b.test/" },
        { title: "Script", url: "javascript:void(0)" },
      ],
      importSource: chromeSource,
      title: "Chrome",
      nextId: 10,
    });
    expect(folder).toEqual({
      id: "10",
      kind: "folder",
      title: "Chrome",
      importSource: chromeSource,
      children: [
        {
          id: "11",
          kind: "folder",
          title: "Bar",
          children: [{ id: "12", kind: "bookmark", title: "A", url: "https://a.test/" }],
        },
        { id: "13", kind: "bookmark", title: "B", url: "https://b.test/" },
      ],
    });
    expect(nextId).toBe(14);
    expect(bookmarkCount).toBe(2);
  });
});

describe("replaceImportedFolder", () => {
  it("should replace the folder in place when the same profile is imported again", () => {
    const first = importChrome(EMPTY_BOOKMARK_ROOTS, 1, "First");
    const withMine = {
      ...first.roots,
      bookmarkBar: [
        ...first.roots.bookmarkBar,
        { id: "mine", kind: "bookmark", title: "Mine", url: "https://mine.test/" },
      ] satisfies BrowserBookmarkNode[],
    };
    const second = importChrome(withMine, first.nextId, "Second");

    expect(second.roots.bookmarkBar.map((node) => node.title)).toEqual(["Chrome", "Mine"]);
    expect(countBookmarks(second.roots.bookmarkBar)).toBe(2);
    const folder = second.roots.bookmarkBar[0];
    expect(folder?.kind === "folder" && folder.children[0]?.kind === "folder").toBe(true);
    expect(JSON.stringify(folder)).toContain("Second");
    expect(JSON.stringify(folder)).not.toContain("First");
  });

  it("should add a separate folder when another profile is imported", () => {
    const first = importChrome(EMPTY_BOOKMARK_ROOTS, 1, "First");
    const other = buildImportedFolder({
      nodes: [{ title: "Work", url: "https://work.test/" }],
      importSource: { sourceId: "chrome", profileId: "Profile 2" },
      title: "Chrome (Work)",
      nextId: first.nextId,
    });
    const roots = replaceImportedFolder(first.roots, other.folder);
    expect(roots.bookmarkBar.map((node) => node.title)).toEqual(["Chrome", "Chrome (Work)"]);
  });

  it("should add a new folder instead of replacing when the imported folder was edited", () => {
    const first = importChrome(EMPTY_BOOKMARK_ROOTS, 1, "First");
    const bar = first.roots.bookmarkBar[0];
    const nested = bar?.kind === "folder" ? bar.children[0] : undefined;
    const bookmarkId = nested?.kind === "folder" ? nested.children[0]?.id : undefined;
    const edited = removeBookmarkNode(first.roots, bookmarkId!);
    const second = importChrome(edited, first.nextId, "Second");
    expect(second.roots.bookmarkBar).toHaveLength(2);
    expect(countBookmarks(second.roots.bookmarkBar)).toBe(1);
  });

  it("should keep replacing the imported folder when it only moved between the two roots", () => {
    const first = importChrome(EMPTY_BOOKMARK_ROOTS, 1, "First");
    const moved = moveBookmarkNode(first.roots, first.roots.bookmarkBar[0]!.id, {
      root: "other",
      parentId: null,
      index: 0,
    });
    const second = importChrome(moved, first.nextId, "Second");
    expect(second.roots.bookmarkBar).toHaveLength(0);
    expect(JSON.stringify(second.roots.other)).toContain("Second");
  });
});

describe("bookmarkFileImport", () => {
  it("should replace the earlier file import when another file with a different name is uploaded", () => {
    const html = (url: string) => `<DL><DT><A HREF="${url}">A</A></DL>`;
    const first = bookmarkFileImport("bookmarks_10_1_26.html", html("https://first.test/"));
    const second = bookmarkFileImport("bookmarks_10_22_26.html", html("https://second.test/"));
    expect(second.importSource).toEqual(first.importSource);
    const a = buildImportedFolder({ ...first, nextId: 1 });
    const b = buildImportedFolder({ ...second, nextId: a.nextId });
    const roots = replaceImportedFolder(
      replaceImportedFolder(EMPTY_BOOKMARK_ROOTS, a.folder),
      b.folder,
    );
    expect(roots.bookmarkBar).toHaveLength(1);
    expect(bookmarkedUrls(roots).has("https://second.test/")).toBe(true);
    expect(bookmarkedUrls(roots).has("https://first.test/")).toBe(false);
  });
});

describe("restoreRemovedBookmark", () => {
  const bookmark = (id: string): BrowserBookmarkNode => ({
    id,
    kind: "bookmark",
    title: id,
    url: `https://${id}.test/`,
  });

  it("should put back only the deleted node when other edits happened after it", () => {
    let roots: BrowserBookmarkRoots = { bookmarkBar: [bookmark("a"), bookmark("b")], other: [] };
    const deleteA = removeBookmarkNodeWithLocation(roots, "a");
    roots = removeBookmarkNodeWithLocation(deleteA.roots, "b").roots;
    roots = addBookmark(roots, bookmark("c"));
    roots = restoreRemovedBookmark(roots, deleteA.removed!);
    expect(roots.bookmarkBar.map((node) => node.id)).toEqual(["a", "c"]);
  });

  it("should restore into the original folder and position when the folder still exists", () => {
    const folder: BrowserBookmarkNode = {
      id: "f",
      kind: "folder",
      title: "F",
      children: [bookmark("x"), bookmark("y"), bookmark("z")],
    };
    const roots: BrowserBookmarkRoots = { bookmarkBar: [], other: [folder] };
    const { roots: without, removed } = removeBookmarkNodeWithLocation(roots, "y");
    expect(removed).toMatchObject({ root: "other", parentId: "f", index: 1 });
    expect(restoreRemovedBookmark(without, removed!)).toEqual(roots);
  });

  it("should fall back to the end of the root when the original folder is gone", () => {
    const folder: BrowserBookmarkNode = {
      id: "f",
      kind: "folder",
      title: "F",
      children: [bookmark("x")],
    };
    const roots: BrowserBookmarkRoots = { bookmarkBar: [folder, bookmark("k")], other: [] };
    const removedX = removeBookmarkNodeWithLocation(roots, "x");
    const withoutFolder = removeBookmarkNode(removedX.roots, "f");
    const restored = restoreRemovedBookmark(withoutFolder, removedX.removed!);
    expect(restored.bookmarkBar.map((node) => node.id)).toEqual(["k", "x"]);
    expect(restoreRemovedBookmark(restored, removedX.removed!)).toBe(restored);
  });

  it("should let a re-import replace the imported folder again when a delete inside it is undone", () => {
    const first = importChrome(EMPTY_BOOKMARK_ROOTS, 1, "First");
    const bar = first.roots.bookmarkBar[0];
    const nested = bar?.kind === "folder" ? bar.children[0] : undefined;
    const bookmarkId = nested?.kind === "folder" ? nested.children[0]?.id : undefined;
    const { roots: without, removed } = removeBookmarkNodeWithLocation(first.roots, bookmarkId!);
    const undone = restoreRemovedBookmark(without, removed!);
    expect(undone).toEqual(first.roots);
    expect(importChrome(undone, first.nextId, "Second").roots.bookmarkBar).toHaveLength(1);
  });
});

describe("bookmark edits", () => {
  it("should add to the bookmarks bar and find the url when bookmarking a page", () => {
    const roots = addBookmark(EMPTY_BOOKMARK_ROOTS, {
      id: "1",
      kind: "bookmark",
      title: "A",
      url: "https://a.test/",
    });
    expect(roots.bookmarkBar).toHaveLength(1);
    expect(bookmarkedUrls(roots).has("https://a.test/")).toBe(true);
  });

  it("should remove every bookmark of a url when un-starring it, including nested ones", () => {
    const { roots } = importChrome(EMPTY_BOOKMARK_ROOTS, 1, "A");
    const starred = addBookmark(roots, {
      id: "x",
      kind: "bookmark",
      title: "A",
      url: "https://a.test/",
    });
    const next = removeBookmarksForUrl(starred, "https://a.test/");
    expect(bookmarkedUrls(next).size).toBe(0);
    expect(next.bookmarkBar.map((node) => node.title)).toEqual(["Chrome"]);
  });

  it("should remove a folder and its contents when deleting it by id", () => {
    const { roots } = importChrome(EMPTY_BOOKMARK_ROOTS, 1, "A");
    const nestedId =
      roots.bookmarkBar[0]?.kind === "folder" ? roots.bookmarkBar[0].children[0]?.id : undefined;
    expect(nestedId).toBeDefined();
    const next = removeBookmarkNode(roots, nestedId!);
    expect(countBookmarks(next.bookmarkBar)).toBe(0);
    expect(next.bookmarkBar).toHaveLength(1);
    expect(removeBookmarkNode(next, "missing")).toBe(next);
  });
});

describe("bookmark structure", () => {
  const bookmark = (id: string): BrowserBookmarkNode => ({
    id,
    kind: "bookmark",
    title: id,
    url: `https://${id}.test/`,
  });
  const folder = (id: string, children: BrowserBookmarkNode[]): BrowserBookmarkNode => ({
    id,
    kind: "folder",
    title: id,
    children,
  });
  const ids = (nodes: ReadonlyArray<BrowserBookmarkNode>) => nodes.map((node) => node.id);
  const sample = (): BrowserBookmarkRoots => ({
    bookmarkBar: [bookmark("a"), bookmark("b"), folder("f", [folder("g", [bookmark("x")])])],
    other: [bookmark("c")],
  });

  it("moveBookmarkNode should count the target index with the node still in place when reordering", () => {
    expect(
      ids(
        moveBookmarkNode(sample(), "a", { root: "bookmarkBar", parentId: null, index: 2 })
          .bookmarkBar,
      ),
    ).toEqual(["b", "a", "f"]);
    expect(
      ids(
        moveBookmarkNode(sample(), "f", { root: "bookmarkBar", parentId: null, index: 0 })
          .bookmarkBar,
      ),
    ).toEqual(["f", "a", "b"]);
    const roots = sample();
    expect(moveBookmarkNode(roots, "a", { root: "bookmarkBar", parentId: null, index: 1 })).toBe(
      roots,
    );
  });

  it("moveBookmarkNode should move across roots and into folders when the destination exists", () => {
    const moved = moveBookmarkNode(sample(), "c", { root: "bookmarkBar", parentId: "g", index: 0 });
    expect(moved.other).toEqual([]);
    expect(JSON.stringify(moved.bookmarkBar)).toContain('"children":[{"id":"c"');
    const roots = sample();
    expect(moveBookmarkNode(roots, "c", { root: "other", parentId: "missing", index: 0 })).toBe(
      roots,
    );
  });

  it("moveBookmarkNode should leave the tree unchanged when a folder is moved into its own descendant", () => {
    const roots = sample();
    expect(moveBookmarkNode(roots, "f", { root: "bookmarkBar", parentId: "g", index: 0 })).toBe(
      roots,
    );
    expect(moveBookmarkNode(roots, "f", { root: "bookmarkBar", parentId: "f", index: 0 })).toBe(
      roots,
    );
  });

  it("moveBookmarkNode should stop an imported folder replacing on re-import when it is moved into a folder", () => {
    const first = importChrome({ bookmarkBar: [folder("f", [])], other: [] }, 10, "First");
    const imported = first.roots.bookmarkBar[1]!;
    const moved = moveBookmarkNode(first.roots, imported.id, {
      root: "bookmarkBar",
      parentId: "f",
      index: 0,
    });
    const second = importChrome(moved, first.nextId, "Second");
    expect(ids(second.roots.bookmarkBar)).toEqual(["f", String(first.nextId)]);
  });

  it("resolveBookmarkDrop should map before, after, inside, and root drops to destinations", () => {
    const roots = sample();
    expect(resolveBookmarkDrop(roots, "c", { id: "b" }, "before")).toEqual({
      root: "bookmarkBar",
      parentId: null,
      index: 1,
    });
    expect(resolveBookmarkDrop(roots, "c", { id: "x" }, "after")).toEqual({
      root: "bookmarkBar",
      parentId: "g",
      index: 1,
    });
    expect(resolveBookmarkDrop(roots, "c", { id: "f" }, "inside")).toEqual({
      root: "bookmarkBar",
      parentId: "f",
      index: 1,
    });
    expect(resolveBookmarkDrop(roots, "a", { root: "other" }, "inside")).toEqual({
      root: "other",
      parentId: null,
      index: 1,
    });
    expect(resolveBookmarkDrop(roots, "c", { id: "f" }, "after", new Set(["f"]))).toEqual({
      root: "bookmarkBar",
      parentId: "f",
      index: 0,
    });
  });

  it("resolveBookmarkDrop should return null when the drop would put a folder inside itself", () => {
    const roots = sample();
    expect(resolveBookmarkDrop(roots, "f", { id: "x" }, "before")).toBeNull();
    expect(resolveBookmarkDrop(roots, "f", { id: "g" }, "inside")).toBeNull();
    expect(resolveBookmarkDrop(roots, "f", { id: "f" }, "after")).toBeNull();
    expect(resolveBookmarkDrop(roots, "f", { id: "g" }, "after", new Set(["g"]))).toBeNull();
  });

  it("updateBookmarkNode should reject the edit when the url is not http or https", () => {
    expect(updateBookmarkNode(sample(), "a", { title: "A", url: "ftp://x" })).toBe(
      "unsupported-url",
    );
    const next = updateBookmarkNode(sample(), "x", { title: "  New ", url: "https://new.test" });
    expect(JSON.stringify(next)).toContain(
      '{"id":"x","kind":"bookmark","title":"New","url":"https://new.test/"}',
    );
  });

  it("updateBookmarkNode should turn an imported folder into an ordinary one when it is renamed", () => {
    const { roots } = importChrome(EMPTY_BOOKMARK_ROOTS, 1, "A");
    const renamed = updateBookmarkNode(roots, roots.bookmarkBar[0]!.id, { title: "Mine" });
    expect(renamed).not.toBe("unsupported-url");
    const node = (renamed as BrowserBookmarkRoots).bookmarkBar[0];
    expect(node).toMatchObject({ kind: "folder", title: "Mine" });
    expect(node && "importSource" in node).toBe(false);
  });

  it("addBookmarkFolder should insert an empty folder at the destination", () => {
    const next = addBookmarkFolder(
      sample(),
      { root: "other", parentId: null, index: 0 },
      { id: "n", title: "New" },
    );
    expect(next.other[0]).toEqual({ id: "n", kind: "folder", title: "New", children: [] });
  });

  it("dissolveBookmarkFolder should put the folder's contents where the folder was", () => {
    expect(ids(dissolveBookmarkFolder(sample(), "f").bookmarkBar)).toEqual(["a", "b", "g"]);
    const roots = sample();
    expect(dissolveBookmarkFolder(roots, "a")).toBe(roots);
  });
});

describe("sanitizePersistedBookmarks", () => {
  it("should drop malformed nodes and keep ids unique when restoring saved bookmarks", () => {
    const restored = sanitizePersistedBookmarks({
      bookmarkBar: [
        { id: "4", kind: "bookmark", title: "A", url: "https://a.test/" },
        { id: "5", kind: "bookmark", title: "Bad", url: "ftp://a.test/" },
        { id: "6", kind: "folder", title: "F", children: [{ id: "7", kind: "nope" }] },
        {
          id: "8",
          kind: "folder",
          title: "Chrome",
          children: [],
          importSource: chromeSource,
          importDetached: true,
        },
        "junk",
      ],
      other: "junk",
      nextId: 2,
    });
    expect(restored.roots).toEqual({
      bookmarkBar: [
        { id: "4", kind: "bookmark", title: "A", url: "https://a.test/" },
        { id: "6", kind: "folder", title: "F", children: [] },
        {
          id: "8",
          kind: "folder",
          title: "Chrome",
          children: [],
          importSource: chromeSource,
          importDetached: true,
        },
      ],
      other: [],
    });
    expect(restored.nextId).toBe(9);
    expect(sanitizePersistedBookmarks(null)).toEqual({ roots: EMPTY_BOOKMARK_ROOTS, nextId: 1 });
  });
});
