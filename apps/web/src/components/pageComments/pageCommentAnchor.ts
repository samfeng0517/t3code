import {
  PAGE_COMMENT_QUOTE_MAX_CHARS,
  PAGE_COMMENT_SELECTOR_MAX_CHARS,
  type PageComment,
  type PageCommentAnchor,
  type PageCommentBox,
  type PageCommentSourceLines,
} from "@t3tools/contracts";
import type {
  HtmlRenderCommentAnchor,
  HtmlRenderCommentAnchorRect,
  HtmlRenderCommentAnchors,
  HtmlRenderCommentView,
} from "@t3tools/shared/htmlRender";

/** A drag shorter than this is a click on one element rather than a region. */
const PAGE_COMMENT_DRAG_THRESHOLD_PX = 6;

const clampPercent = (value: number) =>
  Math.round(Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0)) * 100) / 100;

export function percentBox(
  rect: HtmlRenderCommentAnchorRect,
  page: { readonly width: number; readonly height: number },
): PageCommentBox {
  if (page.width <= 0 || page.height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x = clampPercent((rect.x / page.width) * 100);
  const y = clampPercent((rect.y / page.height) * 100);
  return {
    x,
    y,
    width: Math.min(100 - x, clampPercent((rect.width / page.width) * 100)),
    height: Math.min(100 - y, clampPercent((rect.height / page.height) * 100)),
  };
}

export function quoteText(text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > PAGE_COMMENT_QUOTE_MAX_CHARS
    ? `${flat.slice(0, PAGE_COMMENT_QUOTE_MAX_CHARS - 1)}…`
    : flat;
}

export function normalizeRect(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): HtmlRenderCommentAnchorRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function isRegionPick(rect: HtmlRenderCommentAnchorRect): boolean {
  return (
    rect.width >= PAGE_COMMENT_DRAG_THRESHOLD_PX || rect.height >= PAGE_COMMENT_DRAG_THRESHOLD_PX
  );
}

/**
 * Builds the anchor for a pick on a framed render. `picked` is in the frame's
 * viewport; without an answer from the page (renders published before pages
 * could answer) the frame's own size stands in for the page, which holds
 * whenever the frame fits the page.
 */
export function anchorFromFramePick(input: {
  readonly picked: HtmlRenderCommentAnchorRect;
  readonly frame: { readonly width: number; readonly height: number };
  readonly answer: HtmlRenderCommentAnchor | undefined;
}): PageCommentAnchor {
  const { picked, answer } = input;
  const region = isRegionPick(picked);
  const page = answer?.page ?? input.frame;
  const scroll = answer?.scroll ?? { x: 0, y: 0 };
  const element = answer?.element;
  if (!region && element) {
    return {
      kind: "element",
      selector: element.selector.slice(0, PAGE_COMMENT_SELECTOR_MAX_CHARS) || null,
      tagName: element.tagName || null,
      quote: quoteText(element.text),
      box: percentBox(element.rect, page),
    };
  }
  return {
    kind: "region",
    selector: element?.selector.slice(0, PAGE_COMMENT_SELECTOR_MAX_CHARS) || null,
    tagName: element?.tagName || null,
    quote: element ? quoteText(element.text) : null,
    box: percentBox(
      {
        x: picked.x + scroll.x,
        y: picked.y + scroll.y,
        width: region ? picked.width : 0,
        height: region ? picked.height : 0,
      },
      page,
    ),
  };
}

/**
 * Where a comment's pin goes now. A comment without an entry sits at its saved
 * box; "pending" waits for the page to answer, and "detached" means the
 * element it named is gone or no longer says what it quoted.
 */
export type PageCommentPlacement =
  | {
      readonly status: "placed";
      readonly box: PageCommentBox;
      readonly lines?: PageCommentSourceLines | undefined;
    }
  | { readonly status: "pending" }
  | { readonly status: "detached" };

export type PageCommentPlacements = ReadonlyMap<string, PageCommentPlacement>;

export const NO_PLACEMENTS: PageCommentPlacements = new Map();

export function placementOf(
  placements: PageCommentPlacements,
  comment: PageComment,
): PageCommentPlacement {
  return (
    placements.get(comment.id) ?? {
      status: "placed",
      box: comment.anchor.box,
      lines: comment.anchor.lines,
    }
  );
}

const ELLIPSIS = "…";

/**
 * Whether an element still says what the comment quoted: a selection must
 * still appear in it, and a clicked element must still read the same.
 * Quotes are flattened and may be cut short with an ellipsis.
 */
export function anchorTextMatches(anchor: PageCommentAnchor, text: string): boolean {
  if (anchor.quote === null) return true;
  const flat = text.replace(/\s+/g, " ").trim();
  const truncated = anchor.quote.endsWith(ELLIPSIS);
  const quote = truncated ? anchor.quote.slice(0, -ELLIPSIS.length) : anchor.quote;
  if (anchor.kind === "selection") return flat.includes(quote);
  return truncated ? flat.startsWith(quote) : flat === quote;
}

/** Frame anchors the page is asked to find again: clicked elements with a path. */
export function frameSelectorsToResolve(comments: ReadonlyArray<PageComment>): string[] {
  const selectors = new Set<string>();
  for (const comment of comments) {
    if (comment.anchor.kind === "element" && comment.anchor.selector) {
      selectors.add(comment.anchor.selector);
    }
  }
  return [...selectors];
}

/** Places frame comments from the page's answer to `frameSelectorsToResolve`. */
export function placeFrameComments(
  comments: ReadonlyArray<PageComment>,
  selectors: ReadonlyArray<string>,
  answer: HtmlRenderCommentAnchors,
): Map<string, PageCommentPlacement> {
  const placements = new Map<string, PageCommentPlacement>();
  for (const comment of comments) {
    const { anchor } = comment;
    if (anchor.kind !== "element" || !anchor.selector) continue;
    // Written after the page answered, so its saved box is current.
    const index = selectors.indexOf(anchor.selector);
    if (index < 0) continue;
    const found = answer.anchors[index];
    placements.set(
      comment.id,
      found && anchorTextMatches(anchor, found.text)
        ? { status: "placed", box: percentBox(found.rect, answer.page) }
        : { status: "detached" },
    );
  }
  return placements;
}

/**
 * Pixel position, inside the frame's box, of a box saved as a share of the
 * page. Null when the page has not said how it is scrolled, unless the frame
 * shows the whole page, where the frame's box is the page.
 */
export function frameBoxPosition(
  box: PageCommentBox,
  view: HtmlRenderCommentView | null,
  showsWholePage: boolean,
): {
  left: number | string;
  top: number | string;
  width: number | string;
  height: number | string;
} | null {
  if (view === null) {
    return showsWholePage
      ? { left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }
      : null;
  }
  const { page, scroll } = view;
  return {
    left: (box.x / 100) * page.width - scroll.x,
    top: (box.y / 100) * page.height - scroll.y,
    width: (box.width / 100) * page.width,
    height: (box.height / 100) * page.height,
  };
}

/** The structural slice of a DOM element `cssPathWithin` reads, so it is testable without a DOM. */
export interface PathElement {
  readonly tagName: string;
  /** Lowercase for HTML; SVG's camel case (clipPath) kept, which selectors need. */
  readonly localName: string;
  readonly id: string;
  readonly parentElement: PathElement | null;
  readonly children: ArrayLike<PathElement>;
}

const PLAIN_ID = /^[A-Za-z][\w-]*$/;
const MAX_PATH_DEPTH = 32;

/**
 * A path from `root` for `root.querySelector`: tag names with :nth-of-type,
 * starting at `:scope` so wrappers outside the rendered content never count,
 * or at the nearest id.
 */
export function cssPathWithin(element: PathElement, root: PathElement): string | null {
  const parts: string[] = [];
  let node: PathElement | null = element;
  while (node && node !== root) {
    if (parts.length >= MAX_PATH_DEPTH) return null;
    const tag = node.localName;
    if (node.id && PLAIN_ID.test(node.id)) {
      parts.unshift(`${tag}#${node.id}`);
      return parts.join(" > ");
    }
    const siblings = node.parentElement ? Array.from(node.parentElement.children) : [];
    const sameTag = siblings.filter((sibling) => sibling.tagName === node!.tagName);
    parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
    node = node.parentElement;
  }
  if (node !== root || parts.length === 0) return null;
  const path = `:scope > ${parts.join(" > ")}`;
  return path.length > PAGE_COMMENT_SELECTOR_MAX_CHARS ? null : path;
}

/** Marks rendered Markdown blocks with their 1-based source lines. */
const SOURCE_LINE_ATTRIBUTE = "data-source-line";
const SOURCE_LINE_END_ATTRIBUTE = "data-source-line-end";

export function readSourceLines(
  start: string | null,
  end: string | null,
): PageCommentSourceLines | undefined {
  const first = Number(start);
  const last = end === null ? first : Number(end);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1) return undefined;
  return { start: first, end: Math.max(first, last) };
}

/** How `resolveAnchorElement` looks into rendered content, so it is testable without a DOM. */
export interface AnchorFinder<T> {
  readonly bySelector: (selector: string) => T | null;
  readonly byTagName: (tagName: string) => ReadonlyArray<T>;
  readonly textOf: (element: T) => string;
}

/**
 * Finds the element a saved anchor names after the content changed: its
 * path first, then any element of the same tag that still says what it
 * quoted, so a block moved by an edit above it keeps its comment. Null means
 * the anchor is lost.
 */
export function resolveAnchorElement<T>(
  anchor: PageCommentAnchor,
  finder: AnchorFinder<T>,
): T | null {
  if (anchor.selector) {
    const element = finder.bySelector(anchor.selector);
    if (element !== null && anchorTextMatches(anchor, finder.textOf(element))) return element;
  }
  if (!anchor.tagName || anchor.quote === null) return null;
  return (
    finder
      .byTagName(anchor.tagName)
      .find((element) => anchorTextMatches(anchor, finder.textOf(element))) ?? null
  );
}

/** Blocks a click in rendered Markdown anchors to, so a click in a link or `code` names its line. */
const BLOCK_SELECTOR = "p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,td,th,tr,table,img,figure,hr,dt,dd";

function relativeRect(rect: DOMRectReadOnly, root: HTMLElement): HtmlRenderCommentAnchorRect {
  const rootRect = root.getBoundingClientRect();
  return {
    x: rect.left - rootRect.left,
    y: rect.top - rootRect.top,
    width: rect.width,
    height: rect.height,
  };
}

const rootSize = (root: HTMLElement) => ({
  width: root.scrollWidth || root.clientWidth,
  height: root.scrollHeight || root.clientHeight,
});

const elementText = (element: Element) =>
  element instanceof HTMLElement ? element.innerText : (element.textContent ?? "");

function sourceLinesOf(element: Element, content: HTMLElement): PageCommentSourceLines | undefined {
  const marked = element.closest(`[${SOURCE_LINE_ATTRIBUTE}]`);
  if (!marked || !content.contains(marked)) return undefined;
  return readSourceLines(
    marked.getAttribute(SOURCE_LINE_ATTRIBUTE),
    marked.getAttribute(SOURCE_LINE_END_ATTRIBUTE),
  );
}

/**
 * `content` holds only the rendered Markdown, so paths and lines never see the
 * pins; `frame` is the box pins are positioned in.
 */
export interface MarkdownCommentRoots {
  readonly content: HTMLElement;
  readonly frame: HTMLElement;
}

export function anchorFromElement(
  target: Element,
  roots: MarkdownCommentRoots,
): PageCommentAnchor | null {
  const { content, frame } = roots;
  const block = target.closest(BLOCK_SELECTOR);
  const element = block && content.contains(block) ? block : target;
  if (element === content || !content.contains(element)) return null;
  const lines = sourceLinesOf(element, content);
  return {
    kind: "element",
    ...(lines ? { lines } : {}),
    selector: cssPathWithin(element, content),
    tagName: element.localName,
    quote: quoteText(elementText(element)),
    box: percentBox(relativeRect(element.getBoundingClientRect(), frame), rootSize(frame)),
  };
}

export function anchorFromRange(
  range: Range,
  roots: MarkdownCommentRoots,
): PageCommentAnchor | null {
  const { content, frame } = roots;
  const quote = quoteText(range.toString());
  if (!quote || !content.contains(range.commonAncestorContainer)) return null;
  const container =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  const element = container?.closest(BLOCK_SELECTOR) ?? container;
  const inside = element && element !== content && content.contains(element) ? element : null;
  const lines = inside ? sourceLinesOf(inside, content) : undefined;
  return {
    kind: "selection",
    ...(lines ? { lines } : {}),
    selector: inside ? cssPathWithin(inside, content) : null,
    tagName: inside ? inside.localName : null,
    quote,
    box: percentBox(relativeRect(range.getBoundingClientRect(), frame), rootSize(frame)),
  };
}

/** The range of a flattened quote inside an element, matching whitespace loosely. */
function rangeOfQuote(element: Element, quote: string): Range | null {
  const target = (quote.endsWith(ELLIPSIS) ? quote.slice(0, -ELLIPSIS.length) : quote).trim();
  if (!target) return null;
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  // Each kept character remembers its node and offset, with whitespace runs collapsed.
  const positions: Array<{ node: Text; offset: number }> = [];
  let flat = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    for (let offset = 0; offset < text.data.length; offset += 1) {
      const space = /\s/.test(text.data[offset]!);
      if (space && (flat.length === 0 || flat.endsWith(" "))) continue;
      flat += space ? " " : text.data[offset];
      positions.push({ node: text, offset });
    }
  }
  const at = flat.indexOf(target);
  if (at < 0) return null;
  const first = positions[at]!;
  const last = positions[at + target.length - 1]!;
  const range = element.ownerDocument.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

/** Places Markdown comments against the content as it is rendered now. */
export function placeMarkdownComments(
  comments: ReadonlyArray<PageComment>,
  roots: MarkdownCommentRoots,
): Map<string, PageCommentPlacement> {
  const { content, frame } = roots;
  const size = rootSize(frame);
  const bySelector = (selector: string) => {
    try {
      return content.querySelector(selector);
    } catch {
      return null;
    }
  };
  const byTagName = (tagName: string) => Array.from(content.getElementsByTagName(tagName));
  const placements = new Map<string, PageCommentPlacement>();
  for (const comment of comments) {
    const { anchor } = comment;
    // A dragged region names no element, so it stays where it was drawn.
    if (anchor.kind === "region" || (!anchor.selector && !anchor.tagName)) continue;
    // A selection was read from text nodes, a clicked block from its rendered text.
    const element = resolveAnchorElement(anchor, {
      bySelector,
      byTagName,
      textOf: anchor.kind === "selection" ? (node) => node.textContent ?? "" : elementText,
    });
    if (!element) {
      placements.set(comment.id, { status: "detached" });
      continue;
    }
    const range =
      anchor.kind === "selection" && anchor.quote ? rangeOfQuote(element, anchor.quote) : null;
    const rect = (range ?? element).getBoundingClientRect();
    placements.set(comment.id, {
      status: "placed",
      box: percentBox(relativeRect(rect, frame), size),
      lines: sourceLinesOf(element, content),
    });
  }
  return placements;
}
