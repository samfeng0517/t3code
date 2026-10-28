import type { PageComment } from "@t3tools/contracts";
import {
  htmlRenderCommentAnchorRequest,
  htmlRenderCommentAnchorsRequest,
  htmlRenderCommentScrollRequest,
  readHtmlRenderCommentAnchor,
  readHtmlRenderCommentAnchors,
  readHtmlRenderCommentView,
  type HtmlRenderCommentAnchor,
  type HtmlRenderCommentAnchorRect,
  type HtmlRenderCommentAnchors,
  type HtmlRenderCommentView,
} from "@t3tools/shared/htmlRender";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { randomUUID } from "~/lib/utils";

import { PageCommentPins } from "./PageCommentControls";
import {
  anchorFromFramePick,
  frameBoxPosition,
  frameSelectorsToResolve,
  NO_PLACEMENTS,
  normalizeRect,
  placeFrameComments,
  type PageCommentPlacement,
  type PageCommentPlacements,
} from "./pageCommentAnchor";
import type { PageCommentSession } from "./usePageCommentSession";

// Pages that cannot answer never reply: renders published before pages could,
// and workspace HTML too large for the server to add the anchor script. Picks
// there fall back to regions and pins to their saved boxes.
const ANSWER_TIMEOUT_MS = 400;
const RESIZE_DEBOUNCE_MS = 150;
const WHEEL_LINE_PX = 16;

const NO_COMMENTS: ReadonlyArray<PageComment> = [];

/** CSS zoom on an ancestor (the full-screen dialog) scales client coordinates but not the page's. */
function frameScale(frame: HTMLIFrameElement): number {
  const width = frame.getBoundingClientRect().width;
  return frame.offsetWidth > 0 && width > 0 ? width / frame.offsetWidth : 1;
}

function askFrame(
  frame: HTMLIFrameElement,
  rect: HtmlRenderCommentAnchorRect,
): Promise<HtmlRenderCommentAnchor | undefined> {
  const target = frame.contentWindow;
  if (!target) return Promise.resolve(undefined);
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const finish = (answer: HtmlRenderCommentAnchor | undefined) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(answer);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target) return;
      const answer = readHtmlRenderCommentAnchor(event.data);
      if (answer?.requestId === requestId) finish(answer);
    };
    const timer = window.setTimeout(() => finish(undefined), ANSWER_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    target.postMessage(htmlRenderCommentAnchorRequest(requestId, rect), "*");
  });
}

export interface FrameCommentPlacements {
  /** The page's size and scroll, once it has said; pins follow it. */
  readonly view: HtmlRenderCommentView | null;
  readonly placements: PageCommentPlacements;
}

type Resolution =
  | { readonly status: "waiting" }
  | { readonly status: "unanswered" }
  | {
      readonly status: "answered";
      readonly selectors: ReadonlyArray<string>;
      readonly answer: HtmlRenderCommentAnchors;
    };

/**
 * Asks the framed page where each commented element is now: when the page
 * loads, when the frame resizes, and when the page reports a new size. Pins of
 * clicked elements stay hidden until the page answers.
 */
export function useFrameCommentPlacements(
  session: PageCommentSession | null,
  frame: HTMLIFrameElement | null,
): FrameCommentPlacements {
  const comments = session?.comments ?? NO_COMMENTS;
  const watching =
    session !== null && (comments.length > 0 || session.commenting || session.draft !== null);
  const [view, setView] = useState<HtmlRenderCommentView | null>(null);
  const [resolution, setResolution] = useState<Resolution>({ status: "waiting" });
  const pending = useRef<{ requestId: string; selectors: ReadonlyArray<string> } | null>(null);

  const ask = useEffectEvent(() => {
    const target = frame?.contentWindow;
    if (!target) return;
    const requestId = randomUUID();
    const selectors = frameSelectorsToResolve(comments);
    pending.current = { requestId, selectors };
    target.postMessage(htmlRenderCommentAnchorsRequest(requestId, selectors), "*");
    window.setTimeout(() => {
      if (pending.current?.requestId !== requestId) return;
      pending.current = null;
      setResolution((current) =>
        current.status === "waiting" ? { status: "unanswered" } : current,
      );
    }, ANSWER_TIMEOUT_MS);
  });

  // oxlint-disable-next-line t3code/react-effect-budget -- syncs with the sandboxed frame by window message events and debounced timers, torn down on cleanup
  useEffect(() => {
    if (!frame || !watching) return;
    let timer: number | undefined;
    const askSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(ask, RESIZE_DEBOUNCE_MS);
    };
    let lastPage: HtmlRenderCommentView["page"] | null = null;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const answer = readHtmlRenderCommentAnchors(event.data);
      if (answer && answer.requestId === pending.current?.requestId) {
        const { selectors } = pending.current;
        pending.current = null;
        lastPage = answer.page;
        setView({ page: answer.page, scroll: answer.scroll });
        setResolution({ status: "answered", selectors, answer });
        return;
      }
      const next = readHtmlRenderCommentView(event.data);
      if (!next) return;
      setView(next);
      // Content that grew or reflowed moves elements; scrolling alone does not.
      if (
        lastPage &&
        (lastPage.width !== next.page.width || lastPage.height !== next.page.height)
      ) {
        lastPage = next.page;
        askSoon();
      }
    };
    // A new document starts over: its elements and scroll are unknown until it answers.
    const onLoad = () => {
      setView(null);
      setResolution({ status: "waiting" });
      ask();
    };
    window.addEventListener("message", onMessage);
    frame.addEventListener("load", onLoad);
    const stopResize = observeResize(frame, askSoon);
    ask();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.removeEventListener("load", onLoad);
      stopResize();
    };
  }, [frame, watching]);

  if (resolution.status === "unanswered") return { view, placements: NO_PLACEMENTS };
  if (resolution.status === "answered") {
    return {
      view,
      placements: placeFrameComments(comments, resolution.selectors, resolution.answer),
    };
  }
  const waiting = new Map<string, PageCommentPlacement>();
  for (const comment of comments) {
    if (comment.anchor.kind === "element" && comment.anchor.selector) {
      waiting.set(comment.id, { status: "pending" });
    }
  }
  return { view, placements: waiting };
}

/**
 * Sits over a framed page. The page has an opaque origin, so the overlay takes
 * the reader's click or drag and asks the page what lies there. Pins follow the
 * page's scroll once it reports it, clipped to the frame; a page that never
 * reports draws them only while the frame shows it whole.
 */
export function HtmlRenderCommentOverlay({
  session,
  frame,
  view,
  placements,
  showsWholePage,
}: {
  readonly session: PageCommentSession;
  readonly frame: HTMLIFrameElement | null;
  readonly view: HtmlRenderCommentView | null;
  readonly placements: PageCommentPlacements;
  readonly showsWholePage: boolean;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    readonly start: { x: number; y: number };
    readonly end: { x: number; y: number };
  } | null>(null);
  const picking = useRef(false);

  const pointIn = (target: HTMLIFrameElement, event: { clientX: number; clientY: number }) => {
    const bounds = target.getBoundingClientRect();
    const scale = frameScale(target);
    return { x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale };
  };

  const pick = async (target: HTMLIFrameElement, rect: HtmlRenderCommentAnchorRect) => {
    if (picking.current) return;
    picking.current = true;
    await askFrame(target, rect)
      .then((answer) =>
        session.beginDraft(
          anchorFromFramePick({
            picked: rect,
            frame: { width: target.clientWidth, height: target.clientHeight },
            answer,
          }),
        ),
      )
      .finally(() => {
        picking.current = false;
      });
  };

  // The pick layer covers the frame, so the wheel would stop at it. A frame
  // that scrolls inside gets the wheel forwarded; one that shows the whole page
  // lets it reach the thread. React's wheel listener is passive, hence native.
  const commenting = session.commenting;
  // oxlint-disable-next-line t3code/react-effect-budget -- drives the sandboxed frame's scroll through a non-passive wheel listener on the layer, removed on cleanup
  useEffect(() => {
    const layer = layerRef.current;
    if (!commenting || !layer || !frame || showsWholePage) return;
    const onWheel = (event: WheelEvent) => {
      const target = frame.contentWindow;
      if (!target || event.ctrlKey) return;
      event.preventDefault();
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? WHEEL_LINE_PX
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? frame.clientHeight
            : 1;
      target.postMessage(
        htmlRenderCommentScrollRequest(event.deltaX * unit, event.deltaY * unit),
        "*",
      );
    };
    layer.addEventListener("wheel", onWheel, { passive: false });
    return () => layer.removeEventListener("wheel", onWheel);
  }, [commenting, frame, showsWholePage]);

  const dragRect = drag ? normalizeRect(drag.start, drag.end) : null;

  return (
    <>
      <PageCommentPins
        session={session}
        placements={placements}
        position={(box) => frameBoxPosition(box, view, showsWholePage)}
        clip
      />
      {commenting ? (
        <div
          ref={layerRef}
          className="absolute inset-0 z-10 cursor-crosshair touch-none"
          onPointerDown={(event) => {
            if (event.button !== 0 || !frame) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = pointIn(frame, event);
            setDrag({ start: point, end: point });
          }}
          onPointerMove={(event) => {
            if (!drag || !frame) return;
            setDrag({ start: drag.start, end: pointIn(frame, event) });
          }}
          onPointerUp={(event) => {
            if (!drag || !frame) return;
            setDrag(null);
            void pick(frame, normalizeRect(drag.start, pointIn(frame, event)));
          }}
          onPointerCancel={() => setDrag(null)}
        >
          {dragRect ? (
            <div
              className="absolute rounded-sm border-2 border-primary bg-primary/10"
              style={{
                left: dragRect.x,
                top: dragRect.y,
                width: dragRect.width,
                height: dragRect.height,
              }}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
