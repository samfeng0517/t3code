import type { BrowserExtensionStatus } from "@t3tools/contracts";
import { create } from "zustand";

import { previewBridge } from "~/components/preview/previewBridge";
import { toastManager } from "~/components/ui/toast";
import { t } from "~/i18n";

import { browserExtensionUpdateToast } from "./browserExtensions.logic";

export const browserExtensionsBridge = previewBridge?.extensions ?? null;

interface BrowserExtensionsState {
  /** The desktop's extension list; empty until the first read, and always on the web. */
  extensions: ReadonlyArray<BrowserExtensionStatus>;
  updating: boolean;
}

export const useBrowserExtensionsStore = create<BrowserExtensionsState>()(() => ({
  extensions: [],
  updating: false,
}));

export function setBrowserExtensions(extensions: ReadonlyArray<BrowserExtensionStatus>): void {
  useBrowserExtensionsStore.setState({ extensions });
}

export async function refreshBrowserExtensions(): Promise<void> {
  if (!browserExtensionsBridge) return;
  const listed = await browserExtensionsBridge.list().catch(() => null);
  if (listed !== null) setBrowserExtensions(listed);
}

/**
 * Swaps in newer versions of the extensions copied from other browsers. `manual` is a press of
 * the update button, which also reports that nothing needed updating.
 */
export async function updateBrowserExtensionsFromSources(manual: boolean): Promise<void> {
  const bridge = browserExtensionsBridge;
  if (!bridge || useBrowserExtensionsStore.getState().updating) return;
  useBrowserExtensionsStore.setState({ updating: true });
  try {
    const result = await bridge.updateFromSources();
    setBrowserExtensions(result.extensions);
    const toast = browserExtensionUpdateToast(result, manual, t);
    if (toast) toastManager.add(toast);
  } catch (error) {
    if (manual) {
      toastManager.add({
        type: "error",
        title: t("browser.extensions.updateFailed"),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    useBrowserExtensionsStore.setState({ updating: false });
  }
}
