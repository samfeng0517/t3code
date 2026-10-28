import type { PageComment, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";

import {
  PageCommentPanel,
  PageCommentPins,
  PageCommentToggle,
  percentPosition,
} from "./PageCommentControls";
import {
  anchorFromElement,
  anchorFromRange,
  NO_PLACEMENTS,
  placeMarkdownComments,
  type PageCommentPlacements,
} from "./pageCommentAnchor";
import { usePageCommentSession } from "./usePageCommentSession";

// Edits, image loads, and width changes arrive in bursts; one placement pass covers a burst.
const PLACE_DEBOUNCE_MS = 120;

const NO_COMMENTS: ReadonlyArray<PageComment> = [];

/**
 * Re-finds each comment's element whenever the rendered content, its size, or
 * the comments change, so pins follow an edited file and a comment whose text
 * is gone shows as lost instead of pointing at whatever took its place.
 */
function useMarkdownPlacements(
  comments: ReadonlyArray<PageComment>,
  frameRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
): PageCommentPlacements {
  const [placements, setPlacements] = useState<PageCommentPlacements>(NO_PLACEMENTS);
  // oxlint-disable-next-line t3code/react-effect-budget -- measures the rendered DOM with ResizeObserver and MutationObserver, disconnected on cleanup
  useEffect(() => {
    const frame = frameRef.current;
    const content = contentRef.current;
    if (!frame || !content || comments.length === 0) return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => setPlacements(placeMarkdownComments(comments, { frame, content })),
        PLACE_DEBOUNCE_MS,
      );
    };
    schedule();
    const stopResize = observeResize(frame, schedule);
    const mutation = new MutationObserver(schedule);
    mutation.observe(content, { childList: true, subtree: true, characterData: true });
    return () => {
      window.clearTimeout(timer);
      stopResize();
      mutation.disconnect();
    };
  }, [comments, frameRef, contentRef]);
  return placements;
}

/**
 * Rendered Markdown is the app's own DOM, so a comment anchors to the block the
 * reader clicked or the text they selected, as Orca's review notes do, and
 * names the source lines that block came from. Place it inside the scroll
 * container so pins scroll with the text.
 */
export function MarkdownCommentSurface({
  threadRef,
  relativePath,
  contents,
  children,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly relativePath: string;
  readonly contents: string;
  readonly children: ReactNode;
}) {
  const session = usePageCommentSession(
    threadRef,
    {
      kind: "markdown",
      id: relativePath,
      title: relativePath.split(/[\\/]/).at(-1) ?? relativePath,
    },
    { sourceText: contents },
  );
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const roots = () =>
    frameRef.current && contentRef.current
      ? { frame: frameRef.current, content: contentRef.current }
      : null;
  const placements = useMarkdownPlacements(session?.comments ?? NO_COMMENTS, frameRef, contentRef);
  if (!session) return children;

  return (
    <>
      <div className="sticky top-0 z-20 h-0">
        <div className="absolute end-3 top-2">
          <PageCommentToggle session={session} variant="outline" />
        </div>
      </div>
      <div
        ref={frameRef}
        className={cn("relative", session.commenting && "cursor-crosshair")}
        onClickCapture={(event) => {
          const current = roots();
          if (!session.commenting || !current || !(event.target instanceof Element)) return;
          if (event.target.closest("[data-page-comment-pins]")) return;
          // Links and task checkboxes do nothing while commenting; the click picks instead.
          event.preventDefault();
          event.stopPropagation();
          const selection = window.getSelection();
          const range =
            selection && !selection.isCollapsed && selection.rangeCount > 0
              ? selection.getRangeAt(0)
              : null;
          const anchor = range
            ? anchorFromRange(range, current)
            : anchorFromElement(event.target, current);
          if (anchor) session.beginDraft(anchor);
        }}
      >
        <div ref={contentRef}>{children}</div>
        <PageCommentPins session={session} placements={placements} position={percentPosition} />
      </div>
      <div className="sticky bottom-0 z-20 px-3 pb-3 empty:hidden">
        <PageCommentPanel session={session} placements={placements} hint="markdown" />
      </div>
    </>
  );
}
