import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  pageCommentTargetKey,
  reducePageComments,
  type PageCommentAction,
  type PageCommentsByTarget,
} from "@t3tools/client-runtime/page-comments";
import {
  PageCommentSet,
  type PageCommentAnchor,
  type PageCommentTarget,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

const isPageCommentSet = Schema.is(PageCommentSet);

/** A comment being written, or an existing comment being edited. */
export type PageCommentDraft =
  | { readonly kind: "new"; readonly anchor: PageCommentAnchor; readonly body: string }
  | { readonly kind: "edit"; readonly id: string; readonly body: string };

interface PageCommentStoreState {
  readonly byTarget: PageCommentsByTarget;
  /**
   * Unsaved text per page. It lives here rather than in the page's component,
   * so a timeline row virtualized away and back keeps what the reader typed.
   */
  readonly drafts: Readonly<Record<string, PageCommentDraft>>;
  readonly dispatch: (action: PageCommentAction) => void;
  readonly setDraft: (key: string, draft: PageCommentDraft | null) => void;
}

/**
 * Page comments live on the device that wrote them, like diff comments in a
 * composer draft; sending them to the agent is what puts them in the thread.
 */
export const usePageCommentStore = create<PageCommentStoreState>()(
  persist(
    (set) => ({
      byTarget: {},
      drafts: {},
      dispatch: (action) =>
        set((state) => ({ byTarget: reducePageComments(state.byTarget, action) })),
      setDraft: (key, draft) =>
        set((state) => {
          if (draft !== null) return { drafts: { ...state.drafts, [key]: draft } };
          if (!(key in state.drafts)) return state;
          const { [key]: _removed, ...drafts } = state.drafts;
          return { drafts };
        }),
    }),
    {
      name: "t3code:page-comments:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: ({ byTarget }) => ({ byTarget }),
      merge: (persisted, current) => {
        const stored = (persisted as Partial<Pick<PageCommentStoreState, "byTarget">> | null)
          ?.byTarget;
        if (typeof stored !== "object" || stored === null) return current;
        return {
          ...current,
          byTarget: Object.fromEntries(
            Object.entries(stored).filter(([, set]) => isPageCommentSet(set)),
          ),
        };
      },
    },
  ),
);

export function pageCommentKey(threadRef: ScopedThreadRef, target: PageCommentTarget): string {
  return pageCommentTargetKey(scopedThreadKey(threadRef), target);
}
