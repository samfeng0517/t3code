import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Comments a reader pins to a rendered page: an agent's visual reply, or a
 * rendered Markdown or HTML file. They live on the client that wrote them, like
 * diff comments, and reach the agent as review-comment context when sent.
 */

const PAGE_COMMENT_BODY_MAX_CHARS = 8_000;
export const PAGE_COMMENT_QUOTE_MAX_CHARS = 500;
export const PAGE_COMMENT_SELECTOR_MAX_CHARS = 512;
export const PAGE_COMMENTS_PER_TARGET_MAX = 200;

const Percent = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const Bounded = (max: number) => Schema.String.check(Schema.isMaxLength(max));

/** The anchor's bounding box as percentages of the whole page, not the visible part. */
export const PageCommentBox = Schema.Struct({
  x: Percent,
  y: Percent,
  width: Percent,
  height: Percent,
});
export type PageCommentBox = typeof PageCommentBox.Type;

export const PageCommentAnchorKind = Schema.Literals(["element", "selection", "region"]);
export type PageCommentAnchorKind = typeof PageCommentAnchorKind.Type;

/** 1-based source lines of a rendered Markdown block, inclusive. */
export const PageCommentSourceLines = Schema.Struct({
  start: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  end: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type PageCommentSourceLines = typeof PageCommentSourceLines.Type;

export const PageCommentAnchor = Schema.Struct({
  kind: PageCommentAnchorKind,
  /** Set when the page is rendered from source the client can name lines in. */
  lines: Schema.optionalKey(PageCommentSourceLines),
  selector: Schema.NullOr(Bounded(PAGE_COMMENT_SELECTOR_MAX_CHARS)),
  tagName: Schema.NullOr(Bounded(64)),
  quote: Schema.NullOr(Bounded(PAGE_COMMENT_QUOTE_MAX_CHARS)),
  box: PageCommentBox,
});
export type PageCommentAnchor = typeof PageCommentAnchor.Type;

export const PageCommentTargetKind = Schema.Literals(["html-render", "markdown", "html-file"]);
export type PageCommentTargetKind = typeof PageCommentTargetKind.Type;

export const PageCommentTarget = Schema.Struct({
  kind: PageCommentTargetKind,
  /** The render's attachment id, or the file's workspace-relative path. */
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
  title: Bounded(200),
});
export type PageCommentTarget = typeof PageCommentTarget.Type;

export const PageComment = Schema.Struct({
  // Becomes a composer context id, so it keeps that grammar.
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^[a-z0-9_-]+$/i)),
  anchor: PageCommentAnchor,
  body: TrimmedNonEmptyString.check(Schema.isMaxLength(PAGE_COMMENT_BODY_MAX_CHARS)),
  resolved: Schema.Boolean,
  createdAt: Schema.String,
  /** When the comment was last added to a message; an edit clears it so it goes again. */
  sentAt: Schema.NullOr(Schema.String),
});
export type PageComment = typeof PageComment.Type;

export const PageCommentSet = Schema.Struct({
  target: PageCommentTarget,
  comments: Schema.Array(PageComment).check(Schema.isMaxLength(PAGE_COMMENTS_PER_TARGET_MAX)),
});
export type PageCommentSet = typeof PageCommentSet.Type;
