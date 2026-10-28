import { ReviewCommentContextRecord, type PageComment } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { reviewCommentContextRecord } from "~/lib/composerContextRecords";
import { ReviewCommentContextSchema } from "~/reviewCommentContext";

import { pageCommentReviewComment } from "./pageCommentReview";

const isReviewCommentContext = Schema.is(ReviewCommentContextSchema);
const isReviewCommentContextRecord = Schema.is(ReviewCommentContextRecord);

const comment: PageComment = {
  id: "page-comment-4f1c2b9e-0000-4000-8000-000000000000",
  anchor: {
    kind: "selection",
    selector: "section#plans > p",
    tagName: "p",
    quote: "Billed yearly",
    box: { x: 10, y: 40, width: 30, height: 2 },
  },
  body: "Say monthly instead",
  resolved: false,
  createdAt: "2026-10-21T00:00:00.000Z",
  sentAt: null,
};

describe("page comments sent to the agent", () => {
  it("travel as valid review-comment composer context", () => {
    const fields = pageCommentReviewComment({
      target: { kind: "html-render", id: "thread-1-html", title: "Pricing / plans" },
      comment,
    });
    expect(isReviewCommentContext(fields)).toBe(true);
    const record = reviewCommentContextRecord(fields);
    expect(isReviewCommentContextRecord(record)).toBe(true);
    expect(record.label).toBe("Visual reply “Pricing ∕ plans” “Billed yearly”");
  });

  it("send a Markdown comment with source lines as a file comment on its current lines", () => {
    const fields = pageCommentReviewComment({
      target: { kind: "markdown", id: "docs/plan.md", title: "plan.md" },
      comment: { ...comment, anchor: { ...comment.anchor, lines: { start: 2, end: 2 } } },
      // The block moved down a line since the comment was written.
      placement: { status: "placed", box: comment.anchor.box, lines: { start: 3, end: 4 } },
      sourceText: "# Plan\n\nBilled yearly,\nper seat.\n",
    });
    expect(fields).toMatchObject({
      filePath: "docs/plan.md",
      sectionTitle: "File comment",
      rangeLabel: "L3 to L4",
      diff: "Billed yearly,\nper seat.",
      // The selected words travel with the lines, so the agent knows which part of them.
      text: "Say monthly instead\n\nquote:\nBilled yearly",
    });
    expect(isReviewCommentContext(fields)).toBe(true);
  });

  it("send a lost Markdown comment with its quote, not its stale lines", () => {
    const fields = pageCommentReviewComment({
      target: { kind: "markdown", id: "docs/plan.md", title: "plan.md" },
      comment: { ...comment, anchor: { ...comment.anchor, lines: { start: 3, end: 3 } } },
      placement: { status: "detached" },
      sourceText: "# Plan\n\nSomething else now\n",
    });
    expect(fields.sectionTitle).toBe("Rendered Markdown comment");
    expect(fields.diff).toContain("quote:\nBilled yearly");
    expect(fields.diff).not.toContain("Something else now");
  });

  it("describe the anchor when a Markdown comment has no lines", () => {
    const fields = pageCommentReviewComment({
      target: { kind: "markdown", id: "docs/plan.md", title: "plan.md" },
      comment,
      sourceText: "# Plan",
    });
    expect(fields.sectionTitle).toBe("Rendered Markdown comment");
    expect(fields.diff).toContain("quote:\nBilled yearly");
  });
});
