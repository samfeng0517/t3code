import { pageCommentAnchorLabel } from "@t3tools/client-runtime/page-comments";
import type { PageComment, PageCommentAnchor, PageCommentBox } from "@t3tools/contracts";
import {
  CheckIcon,
  ListXIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  RotateCcwIcon,
  SendIcon,
  Trash2,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { useT } from "~/i18n";
import { cn } from "~/lib/utils";

import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  placementOf,
  type PageCommentPlacement,
  type PageCommentPlacements,
} from "./pageCommentAnchor";
import type { PageCommentSession } from "./usePageCommentSession";

export function PageCommentToggle({
  session,
  variant = "glass",
}: {
  readonly session: PageCommentSession;
  readonly variant?: "glass" | "outline" | "overlay";
}) {
  const t = useT();
  const label = t(session.commenting ? "pageComments.toggle.stop" : "pageComments.toggle.start");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={session.commenting}
            size="icon-xs"
            variant={session.commenting ? "default" : variant}
            onClick={() => session.setCommenting(!session.commenting)}
          />
        }
      >
        <MessageSquarePlusIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="left">{label}</TooltipPopup>
    </Tooltip>
  );
}

export type PageCommentPosition = (box: PageCommentBox) => CSSProperties | null;

export const percentPosition: PageCommentPosition = (box) => ({
  left: `${box.x}%`,
  top: `${box.y}%`,
  width: `${box.width}%`,
  height: `${box.height}%`,
});

function useAnchorLabel() {
  const t = useT();
  return (anchor: PageCommentAnchor, placement: PageCommentPlacement) => {
    if (placement.status === "detached") return t("pageComments.anchorLost");
    const label = pageCommentAnchorLabel(anchor, (position) => t("pageComments.region", position));
    const lines = placement.status === "placed" ? placement.lines : anchor.lines;
    if (!lines) return label;
    return `${lines.start === lines.end ? `L${lines.start}` : `L${lines.start}-L${lines.end}`} · ${label}`;
  };
}

/**
 * Pins sit over the page at the anchor's current position. They never enter
 * the page's own DOM, so a framed render stays exactly what the agent
 * published. `position` maps a page box into this layer, or says it cannot.
 */
export function PageCommentPins({
  session,
  placements,
  position,
  clip = false,
}: {
  readonly session: PageCommentSession;
  readonly placements: PageCommentPlacements;
  readonly position: PageCommentPosition;
  readonly clip?: boolean;
}) {
  const t = useT();
  const { draft } = session;
  const highlightId = draft?.kind === "edit" ? draft.id : session.activeId;
  const highlighted = session.comments.find((comment) => comment.id === highlightId);
  const highlightPlacement = highlighted ? placementOf(placements, highlighted) : null;
  const highlightStyle =
    highlighted && !highlighted.resolved && highlightPlacement?.status === "placed"
      ? position(highlightPlacement.box)
      : null;
  const draftStyle = draft?.kind === "new" ? position(draft.anchor.box) : null;
  return (
    <div
      className={cn("pointer-events-none absolute inset-0 z-10", clip && "overflow-hidden")}
      data-page-comment-pins
    >
      {highlightStyle ? (
        <div
          className="absolute rounded-sm border-2 border-dashed border-primary/70 bg-primary/5"
          style={highlightStyle}
        />
      ) : null}
      {draftStyle ? (
        <div
          className="absolute rounded-sm border-2 border-primary bg-primary/10"
          style={draftStyle}
        />
      ) : null}
      {session.comments.map((comment, index) => {
        if (comment.resolved) return null;
        const placement = placementOf(placements, comment);
        const style = placement.status === "placed" ? position(placement.box) : null;
        if (!style) return null;
        return (
          <button
            key={comment.id}
            type="button"
            aria-label={t("pageComments.pin", { number: index + 1 })}
            className={cn(
              "pointer-events-auto absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-medium text-3xs shadow-sm ring-2 ring-background",
              comment.id === session.activeId
                ? "bg-primary text-primary-foreground"
                : comment.sentAt !== null
                  ? "bg-muted text-muted-foreground"
                  : "bg-foreground text-background",
            )}
            style={{ left: style.left, top: style.top }}
            onClick={(event) => {
              event.stopPropagation();
              session.setActiveId(comment.id === session.activeId ? null : comment.id);
            }}
          >
            {index + 1}
          </button>
        );
      })}
    </div>
  );
}

function IconAction(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function StateTag({ children }: { readonly children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-sm bg-muted px-1 font-medium text-3xs text-muted-foreground">
      {children}
    </span>
  );
}

function PageCommentItem({
  session,
  comment,
  index,
  placement,
}: {
  readonly session: PageCommentSession;
  readonly comment: PageComment;
  readonly index: number;
  readonly placement: PageCommentPlacement;
}) {
  const t = useT();
  const anchorLabel = useAnchorLabel();
  const label = anchorLabel(comment.anchor, placement);
  const sent = comment.sentAt !== null;
  const editing = session.draft?.kind === "edit" && session.draft.id === comment.id;
  return (
    <li
      className={cn(
        "group/page-comment flex items-start gap-2.5 px-3 py-2",
        comment.id === session.activeId && "bg-primary/[0.06]",
        (comment.resolved || sent) && !editing && "text-muted-foreground",
        comment.resolved && "opacity-60",
      )}
      onPointerEnter={() => session.setActiveId(comment.id)}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-3xs text-muted-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          {comment.resolved ? <StateTag>{t("pageComments.resolved")}</StateTag> : null}
          {sent ? <StateTag>{t("pageComments.sentBadge")}</StateTag> : null}
          <span
            className={cn("truncate", placement.status === "detached" && "text-warning-foreground")}
          >
            {label}
          </span>
        </p>
        {editing && session.draft ? (
          <div className="-mx-3 -mb-2">
            <DiffCommentAnnotation
              kind="draft"
              rangeLabel={label}
              text={session.draft.body}
              onTextChange={session.setDraftBody}
              placeholder={t("pageComments.placeholder")}
              submitLabel={t("pageComments.save")}
              onCancel={session.cancelDraft}
              onComment={session.submitDraft}
            />
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-5">{comment.body}</p>
        )}
      </div>
      {editing ? null : (
        <span className="-my-1 flex shrink-0 gap-0.5">
          <IconAction label={t("pageComments.edit")} onClick={() => session.beginEdit(comment.id)}>
            <PencilIcon />
          </IconAction>
          <IconAction
            label={t(comment.resolved ? "pageComments.reopen" : "pageComments.resolve")}
            onClick={() => session.setResolved(comment.id, !comment.resolved)}
          >
            {comment.resolved ? <RotateCcwIcon /> : <CheckIcon />}
          </IconAction>
          <IconAction label={t("pageComments.delete")} onClick={() => session.remove(comment.id)}>
            <Trash2 />
          </IconAction>
        </span>
      )}
    </li>
  );
}

export function PageCommentPanel({
  session,
  placements,
  hint,
}: {
  readonly session: PageCommentSession;
  readonly placements: PageCommentPlacements;
  readonly hint: "frame" | "markdown";
}) {
  const t = useT();
  const anchorLabel = useAnchorLabel();
  const { comments, draft } = session;
  if (!session.commenting && comments.length === 0 && draft === null) return null;
  return (
    <section className="rounded-lg border border-border/70 bg-card text-card-foreground shadow-xs">
      <header className="flex items-center gap-1 px-3 py-1.5">
        <span className="mr-auto text-muted-foreground text-xs">
          {comments.length > 0
            ? t(comments.length === 1 ? "pageComments.count.one" : "pageComments.count.other", {
                count: comments.length,
              })
            : t(hint === "frame" ? "pageComments.hint.frame" : "pageComments.hint.markdown")}
        </span>
        {comments.length > 0 ? (
          <IconAction label={t("pageComments.clearAll")} onClick={() => void session.clearAll()}>
            <ListXIcon />
          </IconAction>
        ) : null}
        <Button
          size="xs"
          disabled={session.unsentCount === 0}
          onClick={() => session.sendToAgent(placements)}
        >
          <SendIcon />
          {t("pageComments.send")}
        </Button>
      </header>
      {draft?.kind === "new" ? (
        <div className="border-border/60 border-t">
          <DiffCommentAnnotation
            kind="draft"
            rangeLabel={anchorLabel(draft.anchor, {
              status: "placed",
              box: draft.anchor.box,
              lines: draft.anchor.lines,
            })}
            text={draft.body}
            onTextChange={session.setDraftBody}
            placeholder={t("pageComments.placeholder")}
            submitLabel={t("pageComments.submit")}
            onCancel={session.cancelDraft}
            onComment={session.submitDraft}
          />
        </div>
      ) : null}
      {comments.length > 0 ? (
        <ol className="max-h-64 divide-y divide-border/50 overflow-y-auto border-border/60 border-t">
          {comments.map((comment, index) => (
            <PageCommentItem
              key={comment.id}
              session={session}
              comment={comment}
              index={index}
              placement={placementOf(placements, comment)}
            />
          ))}
        </ol>
      ) : null}
    </section>
  );
}
