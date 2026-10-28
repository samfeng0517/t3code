import * as Schema from "effect/Schema";
import { type PointerEvent as ReactPointerEvent, useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";
import { useResizeDrag } from "./useResizeDrag";

const RatioSchema = Schema.Finite;

/**
 * Custom property, set on the split's container, holding the first pane's share of its height.
 * Size the panes from it (for example as flex-grow factors) so a live drag can skip React.
 */
export const RESIZABLE_HEIGHT_RATIO_PROPERTY = "--resizable-height-ratio";

export interface UseResizableHeightOptions {
  readonly storageKey: string;
  readonly defaultRatio: number;
  /** Smallest height either pane may be dragged to. */
  readonly minPx: number;
}

export interface ResizableHeightHandlers {
  readonly ref: (node: HTMLElement | null) => (() => void) | undefined;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * A two-pane vertical split stored as a ratio, so it survives window resizes. The handle must be
 * a direct child of the split's container. Persisted on drag-end only, like `useResizableWidth`.
 */
export function useResizableHeight(options: UseResizableHeightOptions): {
  readonly ratio: number;
  readonly handlers: ResizableHeightHandlers;
} {
  const { storageKey, defaultRatio, minPx } = options;

  const clampRatio = (value: number): number => {
    if (!Number.isFinite(value)) return defaultRatio;
    return Math.max(0, Math.min(1, value));
  };

  const readRatio = () => {
    if (typeof window === "undefined") return defaultRatio;
    try {
      const stored = getLocalStorageItem(storageKey, RatioSchema);
      return clampRatio(stored ?? defaultRatio);
    } catch (error) {
      console.error("Could not read persisted pane split.", error);
      return defaultRatio;
    }
  };
  const [ratioState, setRatioState] = useState(() => ({ storageKey, ratio: readRatio() }));
  if (ratioState.storageKey !== storageKey) {
    setRatioState({ storageKey, ratio: readRatio() });
  }

  const ratio = clampRatio(ratioState.ratio);

  const drag = useResizeDrag<HTMLElement>((event) => {
    const host = event.currentTarget.parentElement;
    const total = host?.clientHeight ?? 0;
    if (host === null || total <= 0) return null;
    // The drag commits to the key and ratio it started from, even if the split
    // switches keys before the pointer is released.
    const startStorageKey = storageKey;
    const startRatio = ratio;
    return {
      width: startRatio * total,
      axis: "y",
      edge: "bottom",
      bounds: {
        min: Math.min(minPx, total / 2),
        max: Math.max(total - minPx, total / 2),
      },
      resize(height) {
        host.style.setProperty(RESIZABLE_HEIGHT_RATIO_PROPERTY, String(height / total));
        return height;
      },
      finish(finalHeight) {
        const finalRatio = finalHeight / total;
        setRatioState({ storageKey: startStorageKey, ratio: finalRatio });
        try {
          setLocalStorageItem(startStorageKey, finalRatio, RatioSchema);
        } catch (error) {
          console.error("Could not persist pane split.", error);
        }
      },
      cleanup(committed) {
        // React skips the write when the rendered ratio did not change.
        if (!committed) host.style.setProperty(RESIZABLE_HEIGHT_RATIO_PROPERTY, String(startRatio));
      },
    };
  });

  return {
    ratio,
    handlers: {
      ref: drag.ref,
      onPointerDown: drag.onPointerDown,
      onPointerMove: drag.onPointerMove,
      onPointerUp: drag.onPointerUp,
      onPointerCancel: drag.onPointerCancel,
      onLostPointerCapture: drag.onLostPointerCapture,
    },
  };
}
