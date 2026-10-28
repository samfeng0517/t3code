import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { PageComment, PageCommentSet } from "./pageComments.ts";

const isComment = Schema.is(PageComment);
const decodeSet = Schema.decodeUnknownOption(PageCommentSet);

const comment = {
  id: "page-comment-1",
  anchor: {
    kind: "element",
    selector: "main > h2:nth-of-type(2)",
    tagName: "h2",
    quote: "Revenue by quarter",
    box: { x: 4, y: 12.5, width: 92, height: 3 },
  },
  body: "Use the fiscal year here",
  resolved: false,
  createdAt: "2026-10-21T00:00:00.000Z",
  sentAt: null,
} as const;

describe("PageComment", () => {
  it("accepts an anchored comment", () => {
    expect(isComment(comment)).toBe(true);
  });

  it("rejects a box outside the page", () => {
    expect(
      isComment({
        ...comment,
        anchor: { ...comment.anchor, box: { ...comment.anchor.box, x: 101 } },
      }),
    ).toBe(false);
  });

  it("rejects ids that cannot become composer context ids", () => {
    expect(isComment({ ...comment, id: "page comment/1" })).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(isComment({ ...comment, body: "   " })).toBe(false);
  });

  it("accepts Markdown source lines and rejects line zero", () => {
    const anchor = { ...comment.anchor, lines: { start: 3, end: 5 } };
    expect(isComment({ ...comment, anchor })).toBe(true);
    expect(isComment({ ...comment, anchor: { ...anchor, lines: { start: 0, end: 1 } } })).toBe(
      false,
    );
  });

  it("requires the sent state", () => {
    const { sentAt: _sentAt, ...unsent } = comment;
    expect(isComment(unsent)).toBe(false);
    expect(isComment({ ...comment, sentAt: "2026-10-21T01:00:00.000Z" })).toBe(true);
  });
});

describe("PageCommentSet", () => {
  it("decodes a persisted set and rejects an unknown target kind", () => {
    const target = { kind: "html-render", id: "thread-abc-123.html", title: "Chart" };
    expect(decodeSet({ target, comments: [comment] })._tag).toBe("Some");
    expect(
      decodeSet({
        target: { kind: "html-file", id: "site/index.html", title: "index.html" },
        comments: [],
      })._tag,
    ).toBe("Some");
    expect(decodeSet({ target: { ...target, kind: "pdf" }, comments: [] })._tag).toBe("None");
  });
});
