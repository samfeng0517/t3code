// @effect-diagnostics nodeBuiltinImport:off -- electron-chrome-extensions is a runtime external required lazily, and the alias preload resolves beside the main bundle.

import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import {
  BrowserWindow,
  session as electronSession,
  webContents as electronWebContents,
} from "electron";
import type * as ChromeExtensionsModule from "electron-chrome-extensions";

export const EXTENSION_WINDOW_SIZE = { width: 900, height: 700 };
// A reclick lands within one mousedown -> click round, so this bounds it without
// swallowing a deliberate second click.
export const POPUP_RECLICK_WINDOW_MS = 500;

const BLOCKED_EXTENSION_URL_PROTOCOLS = new Set(["chrome:", "javascript:"]);

interface TabTracker {
  addTab(tab: Electron.WebContents, window: Electron.BaseWindow): void;
}

// @types/chrome is not installed, so ECE's `chrome.*` parameter types resolve to
// nothing useful; these name the fields the registry reads.
interface TabCreateDetails {
  readonly url?: string | undefined;
}

interface WindowCreateDetails {
  readonly url?: string | ReadonlyArray<string> | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

interface AnchorRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// What `<browser-action-list>` sends with `browserAction.activate`.
interface ToolbarActivateDetails {
  readonly eventType: string;
  readonly extensionId: string;
  readonly tabId: number;
  readonly anchorRect: AnchorRect;
}

interface ToolbarActivateEvent {
  readonly type: string;
  readonly sender: Electron.WebContents;
}

interface RouterHandler {
  callback: (event: ToolbarActivateEvent, details: ToolbarActivateDetails) => unknown;
}

interface ExtensionsInternals {
  readonly ctx: { readonly router: { readonly handlers: Map<string, RouterHandler> } };
}

interface CreatedPopup {
  readonly extensionId: string;
  readonly browserWindow?: Electron.BrowserWindow;
  isDestroyed(): boolean;
}

const isLoadableExtensionUrl = (url: string) =>
  URL.canParse(url) && !BLOCKED_EXTENSION_URL_PROTOCOLS.has(new URL(url).protocol);

export const makeExtensionWindowRegistry = (
  createBrowserWindow: (
    options: Electron.BrowserWindowConstructorOptions,
  ) => Electron.BrowserWindow,
) => {
  const windows = new Set<Electron.BaseWindow>();

  const track = (window: Electron.BrowserWindow) => {
    windows.add(window);
    window.once("closed", () => windows.delete(window));
    // A window.open or target=_blank child is its own top-level window while the
    // opener lives; untracked, the main-window lookup would take it for the main window.
    window.webContents.on("did-create-window", track);
  };

  const openWindow = (
    browserSession: Electron.Session,
    size: { readonly width: number; readonly height: number },
  ) => {
    const window = createBrowserWindow({
      ...size,
      webPreferences: { session: browserSession, contextIsolation: true, sandbox: true },
    });
    track(window);
    return window;
  };

  // A failed navigation already shows Chromium's error page in the window.
  const loadIgnoringFailure = (window: Electron.BrowserWindow, url: string) => {
    window.webContents.loadURL(url).catch(() => undefined);
  };

  const callbacksFor = (
    browserSession: Electron.Session,
    tracker: () => TabTracker | undefined,
  ) => ({
    createTab: async (
      details: TabCreateDetails,
    ): Promise<[Electron.WebContents, Electron.BaseWindow]> => {
      const window = openWindow(browserSession, EXTENSION_WINDOW_SIZE);
      // ECE validated the URL before calling createTab and adds the tab itself.
      if (typeof details.url === "string") loadIgnoringFailure(window, details.url);
      return [window.webContents, window];
    },
    createWindow: async (details: WindowCreateDetails): Promise<Electron.BaseWindow> => {
      const size = {
        width: typeof details.width === "number" ? details.width : EXTENSION_WINDOW_SIZE.width,
        height: typeof details.height === "number" ? details.height : EXTENSION_WINDOW_SIZE.height,
      };
      // The patched ECE already resolved and vetted these; the filter keeps a
      // chrome:/javascript: URL out should the patch ever be missing.
      const urls = (typeof details.url === "string" ? [details.url] : (details.url ?? [])).filter(
        isLoadableExtensionUrl,
      );
      const openTab = (url: string | undefined) => {
        const window = openWindow(browserSession, size);
        if (url !== undefined) loadIgnoringFailure(window, url);
        tracker()?.addTab(window.webContents, window);
        return window;
      };
      const [firstUrl, ...extraUrls] = urls;
      const window = openTab(firstUrl);
      // An extension window holds a single tab, so each further URL gets its own window.
      for (const url of extraUrls) openTab(url);
      return window;
    },
    selectTab: (_tab: Electron.WebContents, window: Electron.BaseWindow) => {
      if (windows.has(window)) window.focus();
    },
    // An extension removing an App tab leaves it open but untracked: re-adding it
    // would make ECE observe the tab again and double every event it sends.
    removeTab: (_tab: Electron.WebContents, window: Electron.BaseWindow) => {
      if (windows.has(window)) window.close();
    },
    removeWindow: (window: Electron.BaseWindow) => {
      if (windows.has(window)) window.close();
    },
  });

  // destroy, not close: a beforeunload could keep a window alive and make it the
  // "first window" the main-window lookup falls back to.
  const closeAll = () => {
    for (const window of windows) {
      if (!window.isDestroyed()) window.destroy();
    }
    windows.clear();
  };

  return { callbacksFor, closeAll, owns: (window: Electron.BaseWindow) => windows.has(window) };
};

export const makePopupReclickGuard = (now: () => number) => {
  let lastClosed: { readonly extensionId: string; readonly at: number } | undefined;
  return {
    recordClosed: (extensionId: string) => {
      lastClosed = { extensionId, at: now() };
    },
    consumeIfJustClosed: (extensionId: string) => {
      if (lastClosed?.extensionId !== extensionId) return false;
      if (now() - lastClosed.at > POPUP_RECLICK_WINDOW_MS) return false;
      lastClosed = undefined;
      return true;
    },
  };
};

const registry = makeExtensionWindowRegistry((options) => new BrowserWindow(options));
// @effect-diagnostics-next-line globalDate:off -- Popup activation runs in ECE IPC handlers, outside any Effect runtime.
const popupReclickGuard = makePopupReclickGuard(() => Date.now());
const extensionTabs = new WeakSet<Electron.WebContents>();

// Required on first attach (always after `ready`) rather than imported: loaded before
// `ready`, ECE calls protocol.registerSchemesAsPrivileged, which Electron allows only
// once and the app already calls with its own scheme list.
let chromeExtensionsModule: typeof ChromeExtensionsModule | undefined;
let crxProtocolHandled = false;

const loadChromeExtensions = () => {
  chromeExtensionsModule ??= NodeModule.createRequire(__filename)(
    "electron-chrome-extensions",
  ) as typeof ChromeExtensionsModule;
  return chromeExtensionsModule;
};

const loadedExtensionsFor = (browserSession: Electron.Session) =>
  chromeExtensionsModule?.ElectronChromeExtensions.fromSession(browserSession);

const scaleAnchorRect = ({ x, y, width, height }: AnchorRect, factor: number): AnchorRect => ({
  x: x * factor,
  y: y * factor,
  width: width * factor,
  height: height * factor,
});

export const installToolbarFixes = (
  browserSession: Electron.Session,
  extensions: ChromeExtensionsModule.ElectronChromeExtensions,
  popupReclickGuard: ReturnType<typeof makePopupReclickGuard>,
) => {
  // Wrapping the toolbar's own IPC handler, not `activateClick`, keeps these fixes
  // off `chrome.action.openPopup()`, which also goes through `activateClick`.
  const activateHandler = (extensions as unknown as ExtensionsInternals).ctx.router.handlers.get(
    "browserAction.activate",
  );
  if (!activateHandler) {
    throw new Error("electron-chrome-extensions no longer handles browserAction.activate.");
  }
  const activate = activateHandler.callback;
  activateHandler.callback = (event, details) => {
    if (event.type !== "frame") return activate(event, details);
    const toolbar = event.sender;
    if (details.eventType === "click") {
      // The popup's blur destroys it before the click reaches ECE's own toggle, which
      // would otherwise reopen it.
      if (popupReclickGuard.consumeIfJustClosed(details.extensionId)) return;
      const tab = electronWebContents.fromId(details.tabId);
      // Only the window hosting a tab may make it the active one.
      if (tab && tab.session === browserSession && tab.hostWebContents === toolbar) {
        extensions.selectTab(tab);
      }
    }
    // The toolbar measures its anchor in zoomed CSS pixels, while ECE positions the
    // popup and the context menu in window DIPs.
    return activate(event, {
      ...details,
      anchorRect: scaleAnchorRect(details.anchorRect, toolbar.getZoomFactor()),
    });
  };

  extensions.on("browser-action-popup-created", (popup: CreatedPopup) => {
    // ECE's own blur handler runs first, so a popup destroyed by now was closed by this
    // blur. A popup ECE toggles or that closes itself must not swallow the next click.
    popup.browserWindow?.on("blur", () => {
      if (popup.isDestroyed()) popupReclickGuard.recordClosed(popup.extensionId);
    });
  });
};

export const attachChromeExtensions = (browserSession: Electron.Session): void => {
  const { ElectronChromeExtensions } = loadChromeExtensions();
  if (ElectronChromeExtensions.fromSession(browserSession)) return;
  const extensions = new ElectronChromeExtensions({
    license: "GPL-3.0",
    session: browserSession,
    ...registry.callbacksFor(browserSession, () =>
      ElectronChromeExtensions.fromSession(browserSession),
    ),
  });
  // The instance is already registered, so a later attach returns early: run every
  // remaining step even if one fails, then report the failures together.
  const failures: Array<unknown> = [];
  const runStep = (step: () => void) => {
    try {
      step();
    } catch (cause) {
      failures.push(cause);
    }
  };
  runStep(() => installToolbarFixes(browserSession, extensions, popupReclickGuard));
  // ECE registers its preload in the constructor; the alias must run after `chrome` exists.
  for (const type of ["service-worker", "frame"] as const) {
    runStep(() =>
      browserSession.registerPreloadScript({
        id: `t3code-browser-alias-${type}`,
        type,
        filePath: NodePath.join(__dirname, "browser-extension-alias-preload.cjs"),
      }),
    );
  }
  if (!crxProtocolHandled) {
    runStep(() => {
      // The toolbar's crx:// icons load in the main window, which uses the default session.
      ElectronChromeExtensions.handleCRXProtocol(electronSession.defaultSession);
      crxProtocolHandled = true;
    });
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Chrome extension support was only partly attached.");
  }
};

export const addExtensionTab = (
  guest: Electron.WebContents,
  hostWindow: Electron.BrowserWindow,
): void => {
  const extensions = loadedExtensionsFor(guest.session);
  if (!extensions) return;
  // The renderer registers the guest again on every navigation. Adding it only once
  // keeps a tab an extension removed untracked: ECE observes a re-added tab again and
  // would double every event it sends.
  if (extensionTabs.has(guest)) return;
  extensionTabs.add(guest);
  guest.on("focus", () => extensions.selectTab(guest));
  extensions.addTab(guest, hostWindow);
};

export const extensionContextMenuItems = (
  contents: Electron.WebContents,
  params: Electron.ContextMenuParams,
): ReadonlyArray<Electron.MenuItem> =>
  loadedExtensionsFor(contents.session)?.getContextMenuItems(contents, params) ?? [];

export const closeExtensionWindows = (): void => registry.closeAll();

export const isExtensionWindow = (window: Electron.BaseWindow): boolean => registry.owns(window);
