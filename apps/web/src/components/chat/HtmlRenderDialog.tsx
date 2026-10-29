import type { PageCommentTarget, ScopedThreadRef } from "@t3tools/contracts";
import { MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import { useT } from "~/i18n";

import { HtmlRenderDocument } from "../files/BrowserDocumentFrame";
import {
  HtmlRenderCommentOverlay,
  useFrameCommentPlacements,
} from "../pageComments/HtmlRenderCommentOverlay";
import { PageCommentPanel, PageCommentToggle } from "../pageComments/PageCommentControls";
import { usePageCommentSession } from "../pageComments/usePageCommentSession";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";

export function HtmlRenderDialog(props: {
  readonly src: string;
  readonly title: string;
  readonly threadRef?: ScopedThreadRef | undefined;
  readonly commentTarget: PageCommentTarget;
  readonly onClose: () => void;
}) {
  const t = useT();
  const [zoom, setZoom] = useState(1);
  const comments = usePageCommentSession(props.threadRef, props.commentTarget);
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const { view, placements } = useFrameCommentPlacements(comments, frame);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open, eventDetails) => {
        if (open) return;
        // The dialog takes Escape before the page-comment session sees it, so
        // it steps out one layer at a time: the draft, then comment mode, then
        // the dialog. A draft's own textarea cancels it on the same key.
        if (eventDetails.reason === "escape-key" && comments) {
          const target = eventDetails.event.target;
          if (comments.draft !== null) {
            if (!(target instanceof Element && target.closest("[data-diff-comment-annotation]"))) {
              comments.cancelDraft();
            }
            return;
          }
          if (comments.commenting) {
            comments.setCommenting(false);
            return;
          }
        }
        props.onClose();
      }}
    >
      <DialogPopup
        variant="media"
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="row-start-1"
        initialFocus={closeButtonRef}
      >
        <DialogTitle className="sr-only">
          {t("files.htmlRender.expandedPreview", { title: props.title })}
        </DialogTitle>
        <div className="relative w-[92vw]">
          <Button
            ref={closeButtonRef}
            aria-label={t("common.close")}
            size="icon-xs"
            variant="media-close"
            className="absolute right-0 -top-10 z-20"
            onClick={props.onClose}
          >
            <XIcon />
          </Button>
          <div className="relative">
            <div className="h-[min(86vh,calc(100vh-160px))] overflow-auto overscroll-contain rounded-lg bg-background p-4 shadow-2xl ring-1 ring-border/70 [container-type:size]">
              <div className="relative h-[100cqh] w-[100cqw]" style={{ zoom }}>
                <HtmlRenderDocument
                  src={props.src}
                  title={props.title}
                  threadRef={props.threadRef}
                  className="block size-full"
                  onFrameChange={setFrame}
                />
                {comments ? (
                  <HtmlRenderCommentOverlay
                    session={comments}
                    frame={frame}
                    view={view}
                    placements={placements}
                    showsWholePage={false}
                  />
                ) : null}
              </div>
            </div>
            {comments ? (
              <div className="absolute end-3 bottom-3 z-20 w-[min(24rem,calc(100%-1.5rem))] empty:hidden">
                <PageCommentPanel session={comments} placements={placements} hint="frame" />
              </div>
            ) : null}
          </div>
          <div className="mt-2 flex min-w-0 items-center justify-center gap-3 text-xs text-white/80">
            <span className="truncate">{props.title}</span>
            <div className="flex shrink-0 items-center gap-1">
              {comments ? <PageCommentToggle session={comments} variant="overlay" /> : null}
              <Button
                aria-label={t("workspace.preview.menu.zoomOut")}
                size="icon-sm"
                variant="overlay"
                disabled={zoom === 0.5}
                onClick={() => setZoom((value) => value - 0.25)}
              >
                <MinusIcon />
              </Button>
              <Button
                aria-label={t("workspace.preview.menu.resetZoom")}
                size="sm"
                variant="overlay"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </Button>
              <Button
                aria-label={t("workspace.preview.menu.zoomIn")}
                size="icon-sm"
                variant="overlay"
                disabled={zoom === 2}
                onClick={() => setZoom((value) => value + 0.25)}
              >
                <PlusIcon />
              </Button>
            </div>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
