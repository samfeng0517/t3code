import { unsentPageComments } from "@t3tools/client-runtime/page-comments";
import type {
  PageComment,
  PageCommentAnchor,
  PageCommentTarget,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useT } from "~/i18n";
import { readLocalApi } from "~/localApi";
import { randomUUID } from "~/lib/utils";

import { toastManager } from "../ui/toast";
import { NO_PLACEMENTS, placementOf, type PageCommentPlacements } from "./pageCommentAnchor";
import { pageCommentReviewComment } from "./pageCommentReview";
import { pageCommentKey, usePageCommentStore, type PageCommentDraft } from "./pageCommentStore";

const EMPTY_COMMENTS: ReadonlyArray<PageComment> = [];

export interface PageCommentSession {
  readonly target: PageCommentTarget;
  readonly comments: ReadonlyArray<PageComment>;
  readonly unsentCount: number;
  readonly commenting: boolean;
  readonly setCommenting: (commenting: boolean) => void;
  readonly draft: PageCommentDraft | null;
  readonly beginDraft: (anchor: PageCommentAnchor) => void;
  readonly beginEdit: (id: string) => void;
  readonly setDraftBody: (body: string) => void;
  readonly cancelDraft: () => void;
  readonly submitDraft: (body: string) => void;
  readonly activeId: string | null;
  readonly setActiveId: (id: string | null) => void;
  readonly setResolved: (id: string, resolved: boolean) => void;
  readonly remove: (id: string) => void;
  readonly clearAll: () => Promise<void>;
  readonly sendToAgent: (placements?: PageCommentPlacements) => void;
}

/** Null without a thread: comments go to a thread's composer, so there is nowhere to send them. */
export function usePageCommentSession(
  threadRef: ScopedThreadRef | undefined,
  target: PageCommentTarget,
  options?: {
    /** The Markdown source, so a comment with source lines quotes them like a file comment. */
    readonly sourceText?: string | undefined;
  },
): PageCommentSession | null {
  const t = useT();
  const key = threadRef ? pageCommentKey(threadRef, target) : null;
  const comments = usePageCommentStore((state) =>
    key === null ? EMPTY_COMMENTS : (state.byTarget[key]?.comments ?? EMPTY_COMMENTS),
  );
  const draft = usePageCommentStore((state) => (key === null ? null : (state.drafts[key] ?? null)));
  const dispatch = usePageCommentStore((state) => state.dispatch);
  const setStoredDraft = usePageCommentStore((state) => state.setDraft);
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const [commenting, setCommentingState] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Leaving comment mode drops a comment that was started but never written.
  const setCommenting = (next: boolean) => {
    setCommentingState(next);
    if (!next && key !== null && draft?.kind === "new" && !draft.body.trim()) {
      setStoredDraft(key, null);
    }
  };
  const leaveCommenting = useEffectEvent(() => setCommenting(false));

  // Escape leaves comment mode unless a draft's textarea takes it first to cancel the draft.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to window keydown for Escape and unsubscribes on cleanup
  useEffect(() => {
    if (!commenting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      leaveCommenting();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commenting]);

  if (key === null || threadRef === undefined) return null;
  const setDraft = (next: PageCommentDraft | null) => setStoredDraft(key, next);

  return {
    target,
    comments,
    unsentCount: unsentPageComments(comments).length,
    commenting,
    setCommenting,
    draft,
    beginDraft: (anchor) => {
      setDraft({ kind: "new", anchor, body: draft?.kind === "new" ? draft.body : "" });
      setActiveId(null);
    },
    beginEdit: (id) => {
      const comment = comments.find((entry) => entry.id === id);
      if (!comment) return;
      setDraft({ kind: "edit", id, body: comment.body });
      setActiveId(id);
    },
    setDraftBody: (body) => {
      if (draft) setDraft({ ...draft, body });
    },
    cancelDraft: () => setDraft(null),
    submitDraft: (body) => {
      const trimmed = body.trim();
      if (!draft || !trimmed) return;
      if (draft.kind === "edit") {
        dispatch({ type: "edit", key, id: draft.id, body: trimmed });
        setDraft(null);
        return;
      }
      const id = `page-comment-${randomUUID()}`;
      dispatch({
        type: "add",
        key,
        target,
        comment: {
          id,
          anchor: draft.anchor,
          body: trimmed,
          resolved: false,
          createdAt: new Date().toISOString(),
          sentAt: null,
        },
      });
      setDraft(null);
      setActiveId(id);
    },
    activeId,
    setActiveId,
    setResolved: (id, resolved) => dispatch({ type: "set-resolved", key, id, resolved }),
    remove: (id) => {
      dispatch({ type: "remove", key, id });
      if (draft?.kind === "edit" && draft.id === id) setDraft(null);
    },
    clearAll: async () => {
      if (comments.length === 0) return;
      const confirmed = await readLocalApi()?.dialogs.confirm(
        [
          t(
            comments.length === 1
              ? "pageComments.clearConfirm.title.one"
              : "pageComments.clearConfirm.title.other",
            { count: comments.length },
          ),
          t("pageComments.clearConfirm.body"),
        ].join("\n"),
        { variant: "destructive" },
      );
      if (!confirmed) return;
      dispatch({ type: "clear", key });
      if (draft?.kind === "edit") setDraft(null);
      setActiveId(null);
    },
    sendToAgent: (placements = NO_PLACEMENTS) => {
      const unsent = unsentPageComments(comments);
      if (unsent.length === 0) return;
      for (const comment of unsent) {
        addReviewComment(
          threadRef,
          pageCommentReviewComment({
            target,
            comment,
            placement: placementOf(placements, comment),
            sourceText: options?.sourceText,
          }),
        );
      }
      dispatch({
        type: "mark-sent",
        key,
        ids: unsent.map((comment) => comment.id),
        sentAt: new Date().toISOString(),
      });
      setCommentingState(false);
      toastManager.add({
        type: "success",
        title: t(unsent.length === 1 ? "pageComments.sent.one" : "pageComments.sent.other", {
          count: unsent.length,
        }),
        description: t("pageComments.sent.description"),
      });
    },
  };
}
