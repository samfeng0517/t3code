import type { BrowserBookmarkTreeNode } from "@t3tools/contracts";

/** Which import produced a folder, so importing the same source again replaces it. */
export interface BrowserBookmarkImportSource {
  readonly sourceId: string;
  readonly profileId: string;
}

export interface BrowserBookmark {
  readonly id: string;
  readonly kind: "bookmark";
  readonly title: string;
  readonly url: string;
}

export interface BrowserBookmarkFolder {
  readonly id: string;
  readonly kind: "folder";
  /** For an imported folder, the source's label; the UI words it as "Imported from …". */
  readonly title: string;
  readonly children: ReadonlyArray<BrowserBookmarkNode>;
  readonly importSource?: BrowserBookmarkImportSource;
}

export type BrowserBookmarkNode = BrowserBookmark | BrowserBookmarkFolder;

export interface BrowserBookmarkRoots {
  readonly bookmarkBar: ReadonlyArray<BrowserBookmarkNode>;
  readonly other: ReadonlyArray<BrowserBookmarkNode>;
}

export const EMPTY_BOOKMARK_ROOTS: BrowserBookmarkRoots = { bookmarkBar: [], other: [] };

const MAX_TITLE_LENGTH = 512;
const MAX_URL_LENGTH = 2048;
const MAX_IMPORT_NODES = 20_000;
const MAX_DEPTH = 32;

/** The in-app browser opens only http(s) pages, so anything else is not kept as a bookmark. */
export function normalizeBookmarkUrl(raw: string): string | null {
  if (raw.length > MAX_URL_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  parsed.username = parsed.password = "";
  return parsed.href.length > MAX_URL_LENGTH ? null : parsed.href;
}

const cleanTitle = (title: string) => title.trim().slice(0, MAX_TITLE_LENGTH);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const HREF_PATTERN = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
// Tag bodies stop at `<` as well as `>`: a stray `<` would otherwise swallow the next real tag,
// and every unclosed `<` would rescan the rest of the file.
const TOKEN_PATTERN = /<(\/?)(dl|h3|a)\b([^<>]*)>|<[^<>]*>|([^<]+)/gi;

type MutableTreeNode = { title: string; url?: string; children?: MutableTreeNode[] };

/**
 * Netscape bookmark files (what Chrome's "Export bookmarks" writes) leave `<DT>` and `<p>`
 * unclosed, so a tokenizer that only tracks `<DL>`, `<H3>`, and `<A>` reads them more
 * predictably than a DOM parse, and runs outside a browser.
 */
export function parseNetscapeBookmarksHtml(html: string): BrowserBookmarkTreeNode[] {
  const top: MutableTreeNode[] = [];
  const stack: MutableTreeNode[][] = [];
  let pendingFolder: MutableTreeNode | null = null;
  let capture: { kind: "h3" | "a"; text: string; href: string | null } | null = null;
  let budget = MAX_IMPORT_NODES;
  // Lists opened past MAX_DEPTH add no level, so their closing tags must not pop one either.
  let skippedLists = 0;
  const current = () => stack.at(-1) ?? top;

  for (const match of html.matchAll(TOKEN_PATTERN)) {
    const [, closing, rawTag, attributes, text] = match;
    if (text !== undefined) {
      if (capture) capture.text += text;
      continue;
    }
    const tag = rawTag?.toLowerCase();
    if (tag !== "dl" && tag !== "h3" && tag !== "a") continue;
    if (tag === "dl") {
      if (closing) {
        if (skippedLists > 0) skippedLists -= 1;
        else stack.pop();
      } else if (stack.length < MAX_DEPTH) {
        // A folder's list follows its heading; a bare list (the file's outer one) adds no level.
        stack.push(pendingFolder?.children ?? current());
      } else {
        skippedLists += 1;
      }
      pendingFolder = null;
    } else if (!closing) {
      pendingFolder = null;
      const href = tag === "a" ? (HREF_PATTERN.exec(attributes ?? "") ?? null) : null;
      capture = {
        kind: tag,
        text: "",
        href: href ? decodeEntities(href[1] ?? href[2] ?? href[3] ?? "") : null,
      };
    } else if (capture?.kind === tag && budget > 0) {
      const title = cleanTitle(decodeEntities(capture.text));
      if (tag === "h3") {
        pendingFolder = { title, children: [] };
        current().push(pendingFolder);
        budget -= 1;
      } else {
        const url = capture.href === null ? null : normalizeBookmarkUrl(capture.href);
        if (url !== null) {
          current().push({ title, url });
          budget -= 1;
        }
      }
      capture = null;
    }
  }
  return top;
}

/**
 * Every uploaded bookmarks file shares one import folder: exports are named by date, so keying
 * on the file name would add a folder per upload instead of replacing the last one.
 */
const BOOKMARK_FILE_IMPORT_SOURCE: BrowserBookmarkImportSource = {
  sourceId: "file",
  profileId: "html",
};

export function bookmarkFileImport(
  fileName: string,
  html: string,
): {
  nodes: BrowserBookmarkTreeNode[];
  importSource: BrowserBookmarkImportSource;
  title: string;
} {
  return {
    nodes: parseNetscapeBookmarksHtml(html),
    importSource: BOOKMARK_FILE_IMPORT_SOURCE,
    title: fileName,
  };
}

function toStoredNodes(
  nodes: ReadonlyArray<BrowserBookmarkTreeNode>,
  allocate: () => string,
  counter: { bookmarks: number },
  depth: number,
): BrowserBookmarkNode[] {
  if (depth > MAX_DEPTH) return [];
  const stored: BrowserBookmarkNode[] = [];
  for (const node of nodes) {
    if (node.url !== undefined) {
      const url = normalizeBookmarkUrl(node.url);
      if (url === null) continue;
      counter.bookmarks += 1;
      stored.push({ id: allocate(), kind: "bookmark", title: cleanTitle(node.title), url });
    } else if (node.children !== undefined) {
      const id = allocate();
      stored.push({
        id,
        kind: "folder",
        title: cleanTitle(node.title),
        children: toStoredNodes(node.children, allocate, counter, depth + 1),
      });
    }
  }
  return stored;
}

export function buildImportedFolder(input: {
  readonly nodes: ReadonlyArray<BrowserBookmarkTreeNode>;
  readonly importSource: BrowserBookmarkImportSource;
  readonly title: string;
  readonly nextId: number;
}): { folder: BrowserBookmarkFolder; nextId: number; bookmarkCount: number } {
  let nextId = input.nextId;
  const allocate = () => String(nextId++);
  const id = allocate();
  const counter = { bookmarks: 0 };
  const children = toStoredNodes(input.nodes, allocate, counter, 1);
  return {
    folder: {
      id,
      kind: "folder",
      title: cleanTitle(input.title),
      importSource: input.importSource,
      children,
    },
    nextId,
    bookmarkCount: counter.bookmarks,
  };
}

const sameImportSource = (node: BrowserBookmarkNode, source: BrowserBookmarkImportSource) =>
  node.kind === "folder" &&
  node.importSource?.sourceId === source.sourceId &&
  node.importSource.profileId === source.profileId;

/** Imported folders live at the top of either root; a new import goes at the end of the bar. */
export function replaceImportedFolder(
  roots: BrowserBookmarkRoots,
  folder: BrowserBookmarkFolder,
): BrowserBookmarkRoots {
  const source = folder.importSource;
  if (source === undefined) return addBookmark(roots, folder);
  for (const key of ["bookmarkBar", "other"] as const) {
    const index = roots[key].findIndex((node) => sameImportSource(node, source));
    if (index !== -1) return { ...roots, [key]: roots[key].toSpliced(index, 1, folder) };
  }
  return addBookmark(roots, folder);
}

export function addBookmark(
  roots: BrowserBookmarkRoots,
  node: BrowserBookmarkNode,
): BrowserBookmarkRoots {
  return { ...roots, bookmarkBar: [...roots.bookmarkBar, node] };
}

/** Rebuilds only the branches that change, so untouched folders keep their identity. */
function filterNodes(
  nodes: ReadonlyArray<BrowserBookmarkNode>,
  keep: (node: BrowserBookmarkNode) => boolean,
): ReadonlyArray<BrowserBookmarkNode> {
  let changed = false;
  const next: BrowserBookmarkNode[] = [];
  for (const node of nodes) {
    if (!keep(node)) {
      changed = true;
      continue;
    }
    if (node.kind === "folder") {
      const children = filterNodes(node.children, keep);
      if (children !== node.children) {
        changed = true;
        next.push({ ...node, children });
        continue;
      }
    }
    next.push(node);
  }
  return changed ? next : nodes;
}

function filterRoots(
  roots: BrowserBookmarkRoots,
  keep: (node: BrowserBookmarkNode) => boolean,
): BrowserBookmarkRoots {
  const bookmarkBar = filterNodes(roots.bookmarkBar, keep);
  const other = filterNodes(roots.other, keep);
  return bookmarkBar === roots.bookmarkBar && other === roots.other
    ? roots
    : { bookmarkBar, other };
}

export function removeBookmarkNode(roots: BrowserBookmarkRoots, id: string): BrowserBookmarkRoots {
  return filterRoots(roots, (node) => node.id !== id);
}

/** Where a deleted node sat, so an undo can put back just that node. */
export interface RemovedBookmark {
  readonly node: BrowserBookmarkNode;
  readonly root: keyof BrowserBookmarkRoots;
  readonly parentId: string | null;
  readonly index: number;
}

function locateNode(
  nodes: ReadonlyArray<BrowserBookmarkNode>,
  id: string,
  parentId: string | null,
): Omit<RemovedBookmark, "root"> | null {
  for (const [index, node] of nodes.entries()) {
    if (node.id === id) return { node, parentId, index };
    if (node.kind === "folder") {
      const found = locateNode(node.children, id, node.id);
      if (found) return found;
    }
  }
  return null;
}

export function removeBookmarkNodeWithLocation(
  roots: BrowserBookmarkRoots,
  id: string,
): { roots: BrowserBookmarkRoots; removed: RemovedBookmark | null } {
  for (const root of ["bookmarkBar", "other"] as const) {
    const found = locateNode(roots[root], id, null);
    if (found) return { roots: removeBookmarkNode(roots, id), removed: { ...found, root } };
  }
  return { roots, removed: null };
}

function insertIntoFolder(
  nodes: ReadonlyArray<BrowserBookmarkNode>,
  parentId: string,
  insert: (children: ReadonlyArray<BrowserBookmarkNode>) => ReadonlyArray<BrowserBookmarkNode>,
): ReadonlyArray<BrowserBookmarkNode> | null {
  for (const [index, node] of nodes.entries()) {
    if (node.kind !== "folder") continue;
    if (node.id === parentId) {
      return nodes.toSpliced(index, 1, { ...node, children: insert(node.children) });
    }
    const children = insertIntoFolder(node.children, parentId, insert);
    if (children) return nodes.toSpliced(index, 1, { ...node, children });
  }
  return null;
}

/**
 * Puts a deleted node back at its old position in its old folder, leaving every other node as
 * it is now. A folder that is gone sends it to the end of its root; a node already back is left.
 */
export function restoreRemovedBookmark(
  roots: BrowserBookmarkRoots,
  removed: RemovedBookmark,
): BrowserBookmarkRoots {
  if (
    locateNode(roots.bookmarkBar, removed.node.id, null) ??
    locateNode(roots.other, removed.node.id, null)
  )
    return roots;
  const insertAt = (children: ReadonlyArray<BrowserBookmarkNode>, index: number) =>
    children.toSpliced(Math.min(index, children.length), 0, removed.node);
  const rootNodes = roots[removed.root];
  const restored =
    removed.parentId === null
      ? insertAt(rootNodes, removed.index)
      : (insertIntoFolder(rootNodes, removed.parentId, (children) =>
          insertAt(children, removed.index),
        ) ?? insertAt(rootNodes, rootNodes.length));
  return { ...roots, [removed.root]: restored };
}

export function removeBookmarksForUrl(
  roots: BrowserBookmarkRoots,
  url: string,
): BrowserBookmarkRoots {
  const normalized = normalizeBookmarkUrl(url);
  if (normalized === null) return roots;
  return filterRoots(roots, (node) => node.kind !== "bookmark" || node.url !== normalized);
}

export function countBookmarks(nodes: ReadonlyArray<BrowserBookmarkNode>): number {
  let count = 0;
  for (const node of nodes) count += node.kind === "bookmark" ? 1 : countBookmarks(node.children);
  return count;
}

const urlSetCache = new WeakMap<ReadonlyArray<BrowserBookmarkNode>, ReadonlySet<string>>();

function collectUrls(nodes: ReadonlyArray<BrowserBookmarkNode>, into: Set<string>): void {
  for (const node of nodes) {
    if (node.kind === "bookmark") into.add(node.url);
    else collectUrls(node.children, into);
  }
}

function urlsOf(nodes: ReadonlyArray<BrowserBookmarkNode>): ReadonlySet<string> {
  let urls = urlSetCache.get(nodes);
  if (!urls) {
    const collected = new Set<string>();
    collectUrls(nodes, collected);
    urls = collected;
    urlSetCache.set(nodes, urls);
  }
  return urls;
}

/** Cached per root, so star buttons re-check in constant time until the bookmarks change. */
export function bookmarkedUrls(roots: BrowserBookmarkRoots): {
  has: (url: string) => boolean;
  readonly size: number;
} {
  const bar = urlsOf(roots.bookmarkBar);
  const other = urlsOf(roots.other);
  return {
    has: (url) => bar.has(url) || other.has(url),
    get size() {
      return new Set([...bar, ...other]).size;
    },
  };
}

export function isUrlBookmarked(roots: BrowserBookmarkRoots, url: string): boolean {
  const normalized = normalizeBookmarkUrl(url);
  return normalized !== null && bookmarkedUrls(roots).has(normalized);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function sanitizeNodes(raw: unknown, seen: Set<string>, depth: number): BrowserBookmarkNode[] {
  if (!Array.isArray(raw) || depth > MAX_DEPTH) return [];
  const nodes: BrowserBookmarkNode[] = [];
  for (const candidate of raw) {
    if (!isRecord(candidate)) continue;
    const { id, kind, title } = candidate;
    if (typeof id !== "string" || id.length === 0 || seen.has(id) || typeof title !== "string")
      continue;
    if (kind === "bookmark") {
      const url = typeof candidate.url === "string" ? normalizeBookmarkUrl(candidate.url) : null;
      if (url === null) continue;
      seen.add(id);
      nodes.push({ id, kind, title: cleanTitle(title), url });
    } else if (kind === "folder") {
      seen.add(id);
      const source = candidate.importSource;
      const importSource =
        isRecord(source) &&
        typeof source.sourceId === "string" &&
        typeof source.profileId === "string"
          ? { sourceId: source.sourceId, profileId: source.profileId }
          : undefined;
      nodes.push({
        id,
        kind,
        title: cleanTitle(title),
        children: sanitizeNodes(candidate.children, seen, depth + 1),
        ...(importSource ? { importSource } : {}),
      });
    }
  }
  return nodes;
}

export function sanitizePersistedBookmarks(raw: unknown): {
  roots: BrowserBookmarkRoots;
  nextId: number;
} {
  if (!isRecord(raw)) return { roots: EMPTY_BOOKMARK_ROOTS, nextId: 1 };
  const seen = new Set<string>();
  const bookmarkBar = sanitizeNodes(raw.bookmarkBar, seen, 1);
  const other = sanitizeNodes(raw.other, seen, 1);
  let maxId = 0;
  for (const id of seen) {
    const numeric = Number(id);
    if (Number.isSafeInteger(numeric) && numeric > maxId) maxId = numeric;
  }
  const persistedNextId =
    typeof raw.nextId === "number" && Number.isSafeInteger(raw.nextId) ? raw.nextId : 1;
  return { roots: { bookmarkBar, other }, nextId: Math.max(persistedNextId, maxId + 1) };
}
