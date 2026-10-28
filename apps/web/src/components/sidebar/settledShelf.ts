import * as Schema from "effect/Schema";

import { useLocalStorage } from "~/hooks/useLocalStorage";

const SETTLED_SHELF_EXPANDED_KEY = "t3code:sidebar:settled-expanded";

export function useSettledShelfExpanded() {
  return useLocalStorage(SETTLED_SHELF_EXPANDED_KEY, false, Schema.Boolean);
}

const SETTLED_TOGGLE_ATTRIBUTE = "data-sidebar-settled-toggle";
export const settledShelfToggleProps = { [SETTLED_TOGGLE_ATTRIBUTE]: "" };

/** Collapsing from the list header conceals that header, so focus moves to the footer toggle. */
export function focusSettledShelfToggle() {
  document.querySelector<HTMLElement>(`[${SETTLED_TOGGLE_ATTRIBUTE}]`)?.focus();
}
