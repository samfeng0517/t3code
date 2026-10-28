import type { PageComment, PageCommentTarget } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  PAGE_COMMENT_TARGETS_MAX,
  pageCommentAnchorLabel,
  pageCommentReviewFields,
  pageCommentReviewText,
  pageCommentTargetKey,
  reducePageComments,
  unsentPageComments,
  type PageCommentsByTarget,
} from "./pageComments.ts";

const target: PageCommentTarget = { kind: "html-render", id: "thread-1-html", title: "Q3 / Q4" };
const key = pageCommentTargetKey("env:thread-1", target);

const comment = (id: string, overrides: Partial<PageComment> = {}): PageComment => ({
  id,
  anchor: {
    kind: "element",
    selector: "main > h2",
    tagName: "h2",
    quote: "Revenue by quarter",
    box: { x: 10, y: 20, width: 50, height: 5 },
  },
  body: `comment ${id}`,
  resolved: false,
  createdAt: "2026-10-21T00:00:00.000Z",
  sentAt: null,
  ...overrides,
});

const add = (state: PageCommentsByTarget, id: string, at = key) =>
  reducePageComments(state, { type: "add", key: at, target, comment: comment(id) });

describe("reducePageComments", () => {
  it("adds, resolves, reopens, and removes", () => {
    let state = add(add({}, "a"), "b");
    expect(state[key]?.comments.map((entry) => entry.id)).toEqual(["a", "b"]);

    state = reducePageComments(state, { type: "set-resolved", key, id: "a", resolved: true });
    expect(unsentPageComments(state[key]?.comments).map((entry) => entry.id)).toEqual(["b"]);

    state = reducePageComments(state, { type: "set-resolved", key, id: "a", resolved: false });
    expect(unsentPageComments(state[key]?.comments)).toHaveLength(2);

    state = reducePageComments(state, { type: "remove", key, id: "a" });
    state = reducePageComments(state, { type: "remove", key, id: "b" });
    expect(state).toEqual({});
  });

  it("returns the same state for no-op actions", () => {
    const state = add({}, "a");
    expect(reducePageComments(state, { type: "remove", key, id: "missing" })).toBe(state);
    expect(reducePageComments(state, { type: "set-resolved", key, id: "a", resolved: false })).toBe(
      state,
    );
  });

  it("marks sent comments so the next send leaves them out", () => {
    let state = add(add({}, "a"), "b");
    state = reducePageComments(state, {
      type: "mark-sent",
      key,
      ids: ["a"],
      sentAt: "2026-10-21T01:00:00.000Z",
    });
    expect(state[key]?.comments[0]?.sentAt).toBe("2026-10-21T01:00:00.000Z");
    expect(unsentPageComments(state[key]?.comments).map((entry) => entry.id)).toEqual(["b"]);

    // A second send keeps the first time and leaves an already sent comment alone.
    const again = reducePageComments(state, {
      type: "mark-sent",
      key,
      ids: ["a"],
      sentAt: "2026-10-21T02:00:00.000Z",
    });
    expect(again).toBe(state);

    // Resolving and reopening keeps it sent; deleting still works.
    state = reducePageComments(state, { type: "set-resolved", key, id: "a", resolved: true });
    state = reducePageComments(state, { type: "set-resolved", key, id: "a", resolved: false });
    expect(state[key]?.comments[0]?.sentAt).toBe("2026-10-21T01:00:00.000Z");
    state = reducePageComments(state, { type: "remove", key, id: "a" });
    expect(state[key]?.comments.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("edits a body and queues the edited comment to send again", () => {
    let state = reducePageComments(add({}, "a"), {
      type: "mark-sent",
      key,
      ids: ["a"],
      sentAt: "2026-10-21T01:00:00.000Z",
    });
    state = reducePageComments(state, { type: "edit", key, id: "a", body: "  use FY24  " });
    expect(state[key]?.comments[0]).toMatchObject({ body: "use FY24", sentAt: null });
    expect(reducePageComments(state, { type: "edit", key, id: "a", body: "   " })).toBe(state);
    expect(reducePageComments(state, { type: "edit", key, id: "a", body: "use FY24" })).toBe(state);
  });

  it("clears every comment on a page and nothing else", () => {
    const other = pageCommentTargetKey("env:thread-2", target);
    const state = add(add(add({}, "a"), "b"), "c", other);
    const cleared = reducePageComments(state, { type: "clear", key });
    expect(Object.keys(cleared)).toEqual([other]);
    expect(reducePageComments(cleared, { type: "clear", key })).toBe(cleared);
  });

  it("replaces a comment re-added with the same id", () => {
    const state = add(add({}, "a"), "a");
    expect(state[key]?.comments).toHaveLength(1);
  });

  it("evicts the least recently commented page past the limit", () => {
    let state: PageCommentsByTarget = {};
    for (let index = 0; index <= PAGE_COMMENT_TARGETS_MAX; index += 1) {
      state = add(state, "a", `page-${index}`);
    }
    state = add(state, "b", "page-1");
    expect(Object.keys(state)).toHaveLength(PAGE_COMMENT_TARGETS_MAX);
    expect(state["page-0"]).toBeUndefined();
    expect(Object.keys(state).at(-1)).toBe("page-1");
  });
});

describe("pageCommentAnchorLabel", () => {
  it("labels each anchor kind", () => {
    const base = comment("a").anchor;
    expect(pageCommentAnchorLabel(base)).toBe("<h2> “Revenue by quarter”");
    expect(pageCommentAnchorLabel({ ...base, kind: "selection", quote: "  by\n quarter " })).toBe(
      "“by quarter”",
    );
    const region = { ...base, kind: "region" as const, tagName: null };
    expect(pageCommentAnchorLabel(region)).toBe("region at 10%, 20%");
    expect(pageCommentAnchorLabel(region, ({ x, y }) => `位於 ${x}%, ${y}% 的區域`)).toBe(
      "位於 10%, 20% 的區域",
    );
  });
});

describe("pageCommentReviewFields", () => {
  it("carries the anchor, quote, and comment in the diff-comment shape", () => {
    const fields = pageCommentReviewFields(target, comment("a"));
    expect(fields.filePath).toBe("Visual reply “Q3 ∕ Q4”");
    expect(fields.sectionId).toBe("page:html-render:thread-1-html");
    expect(fields.text).toBe("comment a");
    expect(fields.fenceLanguage).toBe("text");
    expect(fields.diff).toBe(
      [
        "anchor: element <h2>",
        "selector: main > h2",
        "position: x 10%, y 20%, 50% × 5% of the page",
        "quote:",
        "Revenue by quarter",
      ].join("\n"),
    );
  });

  it("leaves out source lines, which may be stale when the anchor is lost", () => {
    const lost = comment("a");
    const fields = pageCommentReviewFields(
      { kind: "markdown", id: "docs/plan.md", title: "plan.md" },
      { ...lost, anchor: { ...lost.anchor, lines: { start: 3, end: 4 } } },
    );
    expect(fields.diff).not.toContain("lines");
    expect(fields.diff).toContain("quote:\nRevenue by quarter");
  });

  it("uses the Markdown file path as the file", () => {
    const fields = pageCommentReviewFields(
      { kind: "markdown", id: "docs/plan.md", title: "plan.md" },
      comment("a"),
    );
    expect(fields.filePath).toBe("docs/plan.md");
    expect(fields.sectionTitle).toBe("Rendered Markdown comment");
  });

  it("names an HTML file by its path", () => {
    const fields = pageCommentReviewFields(
      { kind: "html-file", id: "site/index.html", title: "index.html" },
      comment("a"),
    );
    expect(fields.filePath).toBe("site/index.html");
    expect(fields.sectionTitle).toBe("Rendered HTML comment");
    expect(fields.sectionId).toBe("page:html-file:site/index.html");
  });
});

describe("pageCommentReviewText", () => {
  it("adds a selection's words to the comment and leaves a clicked block's out", () => {
    const base = comment("a", { body: "  Say monthly " });
    expect(pageCommentReviewText(base)).toBe("Say monthly");
    expect(
      pageCommentReviewText({
        ...base,
        anchor: { ...base.anchor, kind: "selection", quote: " yearly " },
      }),
    ).toBe("Say monthly\n\nquote:\nyearly");
  });
});
