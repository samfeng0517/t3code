import {
  pageCommentReviewFields,
  pageCommentReviewText,
} from "@t3tools/client-runtime/page-comments";
import type { PageComment, PageCommentTarget } from "@t3tools/contracts";

import { buildFileReviewComment, type ReviewCommentContext } from "~/reviewCommentContext";

import type { PageCommentPlacement } from "./pageCommentAnchor";

/**
 * A Markdown comment whose block is found travels like a file comment, with
 * its current source lines; a lost one, or anything else, carries its anchor
 * description and original quote, since its old lines may now say something else.
 */
export function pageCommentReviewComment(input: {
  readonly target: PageCommentTarget;
  readonly comment: PageComment;
  /** Where the comment is now; without it, where it was written. */
  readonly placement?: PageCommentPlacement | undefined;
  readonly sourceText?: string | undefined;
}): ReviewCommentContext {
  const { target, comment, sourceText } = input;
  const { placement } = input;
  const lines =
    placement === undefined
      ? comment.anchor.lines
      : placement.status === "placed"
        ? placement.lines
        : undefined;
  if (target.kind === "markdown" && lines && sourceText !== undefined) {
    return buildFileReviewComment({
      id: comment.id,
      filePath: target.id,
      startLine: lines.start,
      endLine: lines.end,
      text: pageCommentReviewText(comment),
      contents: sourceText,
    });
  }
  return pageCommentReviewFields(target, comment);
}
