import type { DesktopPreviewWebviewConfig, EnvironmentId } from "@t3tools/contracts";
import type * as React from "react";
import { useEffect, useState } from "react";

import { usePreviewWebviewConfig } from "~/browser/previewWebviewConfigState";
import { observeResize } from "~/lib/observeResize";

// Defined by electron-chrome-extensions' injectBrowserAction() in the desktop preload.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "browser-action-list": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        partition?: string;
        tab?: number;
        alignment?: string;
      };
    }
  }
}

/** Incognito partitions are not persistent and never get extensions attached. */
export function extensionToolbarPartition(
  config: DesktopPreviewWebviewConfig | null,
): string | null {
  return config?.partition.startsWith("persist:") ? config.partition : null;
}

// Roughly `https://git` beside the field's own star and open-in-browser buttons. At
// the narrowest panel without extensions the field is just wider than this, so that
// layout still counts as fitting.
const MIN_ADDRESS_FIELD_EMS = 10;
// Layout widths are fractional, so the shown and hidden measurements of one layout
// can disagree slightly; a pixel of slack keeps the group from flipping back.
const REVEAL_SLACK = 1;

/**
 * Whether to hide the whole icon group so the address field keeps a usable width.
 * Decides from the field's width as if no icons were shown, which is the same in
 * both states, so toggling never changes the answer.
 */
export function shouldHideExtensionActions({
  fieldWidth,
  groupWidth,
  hidden,
  minFieldWidth,
}: {
  fieldWidth: number;
  groupWidth: number;
  hidden: boolean;
  minFieldWidth: number;
}): boolean {
  if (groupWidth === 0) return false;
  const fieldWidthWithIcons = hidden ? fieldWidth - groupWidth : fieldWidth;
  return fieldWidthWithIcons < minFieldWidth + (hidden ? REVEAL_SLACK : 0);
}

function measureGroupWidth(list: HTMLElement, row: HTMLElement): number {
  const actions = list.shadowRoot?.querySelectorAll<HTMLElement>(".action") ?? [];
  const first = actions[0];
  if (!first) return 0;
  // `display: contents` makes every action a flex item of the row, so each one adds
  // its width plus one row gap. Computed values resolve even while the group is hidden.
  const actionWidth = Number.parseFloat(getComputedStyle(first).width);
  const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
  return actions.length * (actionWidth + gap);
}

/**
 * Hides the list while it would squeeze the row's address field. Runs only when the
 * field resizes or an extension is added or removed. The attribute is set directly
 * so the change lands in the same frame as the measurement instead of a later render.
 */
function useHideWhenAddressFieldTooNarrow(list: HTMLElement | null) {
  // oxlint-disable-next-line t3code/react-effect-budget -- observes the address field's size and toggles an imperative attribute on the extension list, cleaned up on unmount
  useEffect(() => {
    const row = list?.closest("form");
    const field = row?.querySelector<HTMLElement>("[data-preview-address-field]");
    if (!list || !row || !field) return;
    const update = () => {
      const hidden = list.hasAttribute("hidden");
      const hide = shouldHideExtensionActions({
        fieldWidth: field.getBoundingClientRect().width,
        groupWidth: measureGroupWidth(list, row),
        hidden,
        minFieldWidth: MIN_ADDRESS_FIELD_EMS * Number.parseFloat(getComputedStyle(field).fontSize),
      });
      if (hide !== hidden) list.toggleAttribute("hidden", hide);
    };
    const stopObservingResize = observeResize(field, update);
    // An extension added or removed while the group is hidden leaves the field unresized.
    const mutationObserver = new MutationObserver(update);
    if (list.shadowRoot) mutationObserver.observe(list.shadowRoot, { childList: true });
    return () => {
      stopObservingResize();
      mutationObserver.disconnect();
    };
  }, [list]);
}

export function PreviewExtensionActions({
  environmentId,
  profileId,
  webContentsId,
}: {
  environmentId: EnvironmentId;
  profileId: string | undefined;
  webContentsId: number;
}) {
  const partition = extensionToolbarPartition(usePreviewWebviewConfig(environmentId, profileId));
  const [list, setList] = useState<HTMLElement | null>(null);
  useHideWhenAddressFieldTooNarrow(list);
  if (partition === null) return null;
  // Keyed on the partition only: the element subscribes to one partition when it
  // connects, while a tab switch within it just updates `tab`.
  return (
    <browser-action-list
      ref={setList}
      key={partition}
      partition={partition}
      tab={webContentsId}
      alignment="bottom left"
    />
  );
}
