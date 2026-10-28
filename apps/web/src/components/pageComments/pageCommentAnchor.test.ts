import { describe, expect, it } from "vite-plus/test";

import type { PageComment, PageCommentAnchor } from "@t3tools/contracts";

import {
  anchorFromFramePick,
  anchorTextMatches,
  cssPathWithin,
  frameBoxPosition,
  frameSelectorsToResolve,
  isRegionPick,
  normalizeRect,
  percentBox,
  placeFrameComments,
  placementOf,
  quoteText,
  readSourceLines,
  resolveAnchorElement,
  type AnchorFinder,
  type PathElement,
} from "./pageCommentAnchor";

interface FakeElement extends PathElement {
  readonly children: FakeElement[];
}

function element(tagName: string, parent: FakeElement | null, id = ""): FakeElement {
  const node: FakeElement = {
    tagName: tagName.toUpperCase(),
    localName: tagName,
    id,
    parentElement: parent,
    children: [],
  };
  parent?.children.push(node);
  return node;
}

describe("cssPathWithin", () => {
  it("numbers same-tag siblings and stops at the root", () => {
    const root = element("div", null);
    const list = element("ul", root);
    element("li", list);
    const second = element("li", list);
    const strong = element("strong", second);
    expect(cssPathWithin(strong, root)).toBe(":scope > ul > li:nth-of-type(2) > strong");
  });

  it("stops at the nearest plain id", () => {
    const root = element("div", null);
    const section = element("section", root, "usage");
    const paragraph = element("p", section);
    expect(cssPathWithin(paragraph, root)).toBe("section#usage > p");
  });

  it("ignores ids that are not plain identifiers", () => {
    const root = element("div", null);
    const heading = element("h2", root, "1. intro");
    expect(cssPathWithin(heading, root)).toBe(":scope > h2");
  });

  it("keeps SVG's camel-case names, which selectors match case-sensitively", () => {
    const root = element("div", null);
    const clip = element("clipPath", element("svg", root));
    expect(cssPathWithin(clip, root)).toBe(":scope > svg > clipPath");
  });

  it("names no path for an element outside the root, such as the pins layer", () => {
    const frame = element("div", null);
    const content = element("div", frame);
    const pins = element("div", frame);
    const pin = element("button", pins);
    expect(cssPathWithin(pin, content)).toBeNull();
    expect(cssPathWithin(content, content)).toBeNull();
  });
});

describe("readSourceLines", () => {
  it("reads 1-based inclusive lines and rejects junk", () => {
    expect(readSourceLines("4", "6")).toEqual({ start: 4, end: 6 });
    expect(readSourceLines("4", null)).toEqual({ start: 4, end: 4 });
    expect(readSourceLines("0", "1")).toBeUndefined();
    expect(readSourceLines(null, null)).toBeUndefined();
    expect(readSourceLines("x", "2")).toBeUndefined();
  });
});

const anchor = (overrides: Partial<PageCommentAnchor> = {}): PageCommentAnchor => ({
  kind: "element",
  selector: ":scope > p:nth-of-type(2)",
  tagName: "p",
  quote: "Billed yearly per seat",
  box: { x: 0, y: 10, width: 100, height: 5 },
  ...overrides,
});

const comment = (id: string, overrides: Partial<PageCommentAnchor> = {}): PageComment => ({
  id,
  anchor: anchor(overrides),
  body: "Say monthly",
  resolved: false,
  createdAt: "2026-10-21T00:00:00.000Z",
  sentAt: null,
});

describe("anchorTextMatches", () => {
  it("needs a clicked element to read the same and a selection to still appear", () => {
    expect(anchorTextMatches(anchor(), " Billed  yearly\nper seat ")).toBe(true);
    expect(anchorTextMatches(anchor(), "Billed monthly per seat")).toBe(false);
    expect(anchorTextMatches(anchor({ kind: "selection", quote: "yearly" }), "Billed yearly")).toBe(
      true,
    );
    expect(anchorTextMatches(anchor({ kind: "selection", quote: "yearly" }), "Billed")).toBe(false);
    expect(anchorTextMatches(anchor({ quote: "Billed year…" }), "Billed yearly per seat")).toBe(
      true,
    );
    expect(anchorTextMatches(anchor({ quote: null }), "anything")).toBe(true);
  });
});

describe("resolveAnchorElement", () => {
  interface Block {
    readonly selector: string;
    readonly tagName: string;
    readonly text: string;
  }
  const finder = (blocks: ReadonlyArray<Block>): AnchorFinder<Block> => ({
    bySelector: (selector) => blocks.find((block) => block.selector === selector) ?? null,
    byTagName: (tagName) => blocks.filter((block) => block.tagName === tagName),
    textOf: (block) => block.text,
  });

  it("finds the element at its path while it says the same", () => {
    const blocks = [
      { selector: ":scope > p:nth-of-type(1)", tagName: "p", text: "Intro" },
      { selector: ":scope > p:nth-of-type(2)", tagName: "p", text: "Billed yearly per seat" },
    ];
    expect(resolveAnchorElement(anchor(), finder(blocks))).toBe(blocks[1]);
  });

  it("follows a block an edit above it moved", () => {
    const moved = {
      selector: ":scope > p:nth-of-type(3)",
      tagName: "p",
      text: "Billed yearly per seat",
    };
    const blocks = [
      { selector: ":scope > p:nth-of-type(1)", tagName: "p", text: "Intro" },
      { selector: ":scope > p:nth-of-type(2)", tagName: "p", text: "A new paragraph" },
      moved,
    ];
    expect(resolveAnchorElement(anchor(), finder(blocks))).toBe(moved);
  });

  it("is lost when the quoted text is gone", () => {
    const blocks = [
      { selector: ":scope > p:nth-of-type(2)", tagName: "p", text: "Billed monthly" },
    ];
    expect(resolveAnchorElement(anchor(), finder(blocks))).toBeNull();
    expect(resolveAnchorElement(anchor(), finder([]))).toBeNull();
  });
});

describe("frame placements", () => {
  const answer = {
    requestId: "r1",
    page: { width: 400, height: 1000 },
    scroll: { x: 0, y: 300 },
    anchors: [
      { text: "Billed yearly per seat", rect: { x: 0, y: 500, width: 400, height: 50 } },
      { text: "Something else now", rect: { x: 0, y: 0, width: 10, height: 10 } },
      null,
    ],
  };

  it("asks only for clicked elements, once per path", () => {
    const comments = [
      comment("a"),
      comment("b"),
      comment("c", { kind: "region", selector: "main" }),
      comment("d", { selector: "h2" }),
    ];
    expect(frameSelectorsToResolve(comments)).toEqual([":scope > p:nth-of-type(2)", "h2"]);
  });

  it("moves found elements, loses changed or missing ones, and leaves the rest", () => {
    const comments = [
      comment("moved"),
      comment("changed", { selector: "h2" }),
      comment("missing", { selector: "h3" }),
      comment("region", { kind: "region", selector: "h3" }),
      comment("new", { selector: "h4" }),
    ];
    const placements = placeFrameComments(
      comments,
      [":scope > p:nth-of-type(2)", "h2", "h3"],
      answer,
    );
    expect(placementOf(placements, comments[0]!)).toEqual({
      status: "placed",
      box: { x: 0, y: 50, width: 100, height: 5 },
    });
    expect(placementOf(placements, comments[1]!)).toEqual({ status: "detached" });
    expect(placementOf(placements, comments[2]!)).toEqual({ status: "detached" });
    expect(placementOf(placements, comments[3]!)).toMatchObject({
      status: "placed",
      box: comments[3]!.anchor.box,
    });
    expect(placementOf(placements, comments[4]!)).toMatchObject({
      status: "placed",
      box: comments[4]!.anchor.box,
    });
  });

  it("positions pins by the page's scroll, or by the frame only when it shows the whole page", () => {
    const box = { x: 25, y: 50, width: 50, height: 10 };
    expect(frameBoxPosition(box, answer, false)).toEqual({
      left: 100,
      top: 200,
      width: 200,
      height: 100,
    });
    expect(frameBoxPosition(box, null, false)).toBeNull();
    expect(frameBoxPosition(box, null, true)).toEqual({
      left: "25%",
      top: "50%",
      width: "50%",
      height: "10%",
    });
  });
});

describe("percentBox", () => {
  it("converts a page rectangle to clamped percentages", () => {
    expect(
      percentBox({ x: 80, y: 50, width: 40, height: 1000 }, { width: 400, height: 200 }),
    ).toEqual({ x: 20, y: 25, width: 10, height: 75 });
    expect(percentBox({ x: -10, y: 0, width: 10, height: 10 }, { width: 0, height: 100 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe("quoteText", () => {
  it("flattens whitespace and drops empty text", () => {
    expect(quoteText("  Revenue\n\n by   quarter ")).toBe("Revenue by quarter");
    expect(quoteText(" \n ")).toBeNull();
    expect(quoteText("x".repeat(600))).toHaveLength(500);
  });
});

describe("frame picks", () => {
  const frame = { width: 400, height: 200 };
  const answer = {
    requestId: "r1",
    page: { width: 400, height: 800 },
    scroll: { x: 0, y: 100 },
    element: {
      selector: "main > h2",
      tagName: "h2",
      text: " Revenue ",
      rect: { x: 0, y: 200, width: 400, height: 40 },
    },
  };

  it("treats a short drag as a click", () => {
    const click = normalizeRect({ x: 12, y: 10 }, { x: 10, y: 14 });
    expect(click).toEqual({ x: 10, y: 10, width: 2, height: 4 });
    expect(isRegionPick(click)).toBe(false);
    expect(isRegionPick(normalizeRect({ x: 0, y: 0 }, { x: 0, y: 20 }))).toBe(true);
  });

  it("anchors a click to the element the page reports", () => {
    expect(
      anchorFromFramePick({ picked: { x: 5, y: 5, width: 0, height: 0 }, frame, answer }),
    ).toEqual({
      kind: "element",
      selector: "main > h2",
      tagName: "h2",
      quote: "Revenue",
      box: { x: 0, y: 25, width: 100, height: 5 },
    });
  });

  it("keeps a dragged region in page coordinates with the element as context", () => {
    const anchor = anchorFromFramePick({
      picked: { x: 40, y: 0, width: 80, height: 100 },
      frame,
      answer,
    });
    expect(anchor.kind).toBe("region");
    expect(anchor.selector).toBe("main > h2");
    expect(anchor.box).toEqual({ x: 10, y: 12.5, width: 20, height: 12.5 });
  });

  it("falls back to the frame's size when the page does not answer", () => {
    expect(
      anchorFromFramePick({
        picked: { x: 100, y: 50, width: 0, height: 0 },
        frame,
        answer: undefined,
      }),
    ).toEqual({
      kind: "region",
      selector: null,
      tagName: null,
      quote: null,
      box: { x: 25, y: 25, width: 0, height: 0 },
    });
  });
});
