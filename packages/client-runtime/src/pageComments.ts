import {
  PAGE_COMMENTS_PER_TARGET_MAX,
  type PageComment,
  type PageCommentAnchor,
  type PageCommentSet,
  type PageCommentTarget,
} from "@t3tools/contracts";

/** Keyed by `pageCommentTargetKey`, so each thread keeps its own comments on a page. */
export type PageCommentsByTarget = Readonly<Record<string, PageCommentSet>>;

export const PAGE_COMMENT_TARGETS_MAX = 100;

export type PageCommentAction =
  | {
      readonly type: "add";
      readonly key: string;
      readonly target: PageCommentTarget;
      readonly comment: PageComment;
    }
  | {
      readonly type: "set-resolved";
      readonly key: string;
      readonly id: string;
      readonly resolved: boolean;
    }
  | { readonly type: "edit"; readonly key: string; readonly id: string; readonly body: string }
  | {
      readonly type: "mark-sent";
      readonly key: string;
      readonly ids: ReadonlyArray<string>;
      readonly sentAt: string;
    }
  | { readonly type: "remove"; readonly key: string; readonly id: string }
  | { readonly type: "clear"; readonly key: string };

function withoutKey(state: PageCommentsByTarget, key: string): PageCommentsByTarget {
  return Object.fromEntries(Object.entries(state).filter(([entry]) => entry !== key));
}

function updateComments(
  state: PageCommentsByTarget,
  key: string,
  update: (comment: PageComment) => PageComment,
): PageCommentsByTarget {
  const current = state[key];
  if (!current) return state;
  let changed = false;
  const comments = current.comments.map((comment) => {
    const next = update(comment);
    if (next !== comment) changed = true;
    return next;
  });
  return changed ? { ...state, [key]: { ...current, comments } } : state;
}

export function pageCommentTargetKey(threadKey: string, target: PageCommentTarget): string {
  return `${threadKey}|${target.kind}:${target.id}`;
}

export function reducePageComments(
  state: PageCommentsByTarget,
  action: PageCommentAction,
): PageCommentsByTarget {
  const current = state[action.key];
  switch (action.type) {
    case "add": {
      const comments = [
        ...(current?.comments ?? []).filter((comment) => comment.id !== action.comment.id),
        action.comment,
      ].slice(-PAGE_COMMENTS_PER_TARGET_MAX);
      // The newest target moves to the end, so eviction drops the least recently commented page.
      const entries = [
        ...Object.entries(state).filter(([key]) => key !== action.key),
        [action.key, { target: action.target, comments }] as const,
      ];
      return Object.fromEntries(entries.slice(-PAGE_COMMENT_TARGETS_MAX));
    }
    case "set-resolved":
      return updateComments(state, action.key, (comment) =>
        comment.id === action.id && comment.resolved !== action.resolved
          ? { ...comment, resolved: action.resolved }
          : comment,
      );
    case "edit": {
      const body = action.body.trim();
      if (!body) return state;
      // An edited comment says something new, so it goes to the agent again.
      return updateComments(state, action.key, (comment) =>
        comment.id === action.id && comment.body !== body
          ? { ...comment, body, sentAt: null }
          : comment,
      );
    }
    case "mark-sent": {
      const ids = new Set(action.ids);
      return updateComments(state, action.key, (comment) =>
        ids.has(comment.id) && comment.sentAt === null
          ? { ...comment, sentAt: action.sentAt }
          : comment,
      );
    }
    case "remove": {
      if (!current) return state;
      const comments = current.comments.filter((comment) => comment.id !== action.id);
      if (comments.length === current.comments.length) return state;
      if (comments.length > 0) return { ...state, [action.key]: { ...current, comments } };
      return withoutKey(state, action.key);
    }
    case "clear":
      return current ? withoutKey(state, action.key) : state;
  }
}

/** What "Send to agent" adds: open comments not already in a message since they last changed. */
export function unsentPageComments(
  comments: ReadonlyArray<PageComment> | undefined,
): ReadonlyArray<PageComment> {
  return comments?.filter((comment) => !comment.resolved && comment.sentAt === null) ?? [];
}

const LABEL_QUOTE_MAX_CHARS = 48;

function shortQuote(quote: string): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_QUOTE_MAX_CHARS
    ? `${flat.slice(0, LABEL_QUOTE_MAX_CHARS - 1)}…`
    : flat;
}

const round = (value: number) => Math.round(value);

function describeBox(anchor: PageCommentAnchor): string {
  const { x, y, width, height } = anchor.box;
  return `x ${round(x)}%, y ${round(y)}%, ${round(width)}% × ${round(height)}% of the page`;
}

export type PageCommentRegionLabel = (position: {
  readonly x: number;
  readonly y: number;
}) => string;

const englishRegionLabel: PageCommentRegionLabel = ({ x, y }) => `region at ${x}%, ${y}%`;

/**
 * A short label for the comment's anchor. Composer chips and the agent read the
 * English default; the client passes its own words for a region shown on screen.
 */
export function pageCommentAnchorLabel(
  anchor: PageCommentAnchor,
  regionLabel: PageCommentRegionLabel = englishRegionLabel,
): string {
  if (anchor.kind === "selection" && anchor.quote) return `“${shortQuote(anchor.quote)}”`;
  if (anchor.kind === "element" && anchor.tagName) {
    return anchor.quote
      ? `<${anchor.tagName}> “${shortQuote(anchor.quote)}”`
      : `<${anchor.tagName}>`;
  }
  return regionLabel({ x: round(anchor.box.x), y: round(anchor.box.y) });
}

/**
 * A comment's text as the agent reads it beside source lines. A selection
 * names a few words inside those lines, so it travels with them.
 */
export function pageCommentReviewText(comment: PageComment): string {
  const body = comment.body.trim();
  const { anchor } = comment;
  return anchor.kind === "selection" && anchor.quote
    ? [body, "", "quote:", anchor.quote.trim()].join("\n")
    : body;
}

/**
 * The fields of a review comment that carry a page comment to the agent. They
 * reuse the diff-comment context kind, so the composer, the prompt envelope,
 * and every provider need nothing new.
 */
export interface PageCommentReviewFields {
  readonly id: string;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly filePath: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly rangeLabel: string;
  readonly text: string;
  readonly diff: string;
  readonly fenceLanguage: string;
}

export function pageCommentReviewFields(
  target: PageCommentTarget,
  comment: PageComment,
): PageCommentReviewFields {
  const { anchor } = comment;
  const details = [
    `anchor: ${anchor.kind}${anchor.tagName ? ` <${anchor.tagName}>` : ""}`,
    ...(anchor.selector ? [`selector: ${anchor.selector}`] : []),
    `position: ${describeBox(anchor)}`,
    ...(anchor.quote ? ["quote:", anchor.quote.trim()] : []),
  ];
  const visualReply = target.kind === "html-render";
  return {
    id: comment.id,
    sectionId: `page:${target.kind}:${target.id}`,
    sectionTitle: visualReply
      ? "Visual reply comment"
      : target.kind === "html-file"
        ? "Rendered HTML comment"
        : "Rendered Markdown comment",
    // Composer chips show the last path segment, so a title must not contain separators.
    filePath: visualReply
      ? `Visual reply “${target.title.replace(/[\\/]/g, "∕") || "Untitled"}”`
      : target.id,
    startIndex: 0,
    endIndex: 0,
    rangeLabel: pageCommentAnchorLabel(anchor),
    text: comment.body.trim(),
    diff: details.join("\n"),
    fenceLanguage: "text",
  };
}
