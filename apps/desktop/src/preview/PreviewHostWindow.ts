import type { WebContents } from "electron";
import { BrowserWindow } from "electron";

// Webview guests have no window; use their embedding page.
export const previewHostWindow = (guest: WebContents | null): BrowserWindow | undefined => {
  if (guest === null || guest.isDestroyed()) return undefined;
  const host = guest.hostWebContents ?? guest;
  if (host.isDestroyed()) return undefined;
  return BrowserWindow.fromWebContents(host) ?? undefined;
};
