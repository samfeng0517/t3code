import * as NodeEvents from "node:events";

import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

const electronFakes = vi.hoisted(() => ({ webContentsById: new Map<number, unknown>() }));

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  session: { defaultSession: undefined },
  webContents: { fromId: (id: number) => electronFakes.webContentsById.get(id) },
}));

import type * as ChromeExtensionsModule from "electron-chrome-extensions";

import {
  EXTENSION_WINDOW_SIZE,
  POPUP_RECLICK_WINDOW_MS,
  installToolbarFixes,
  makeExtensionWindowRegistry,
  makePopupReclickGuard,
} from "./ChromeExtensions.ts";

const makeFakeWebContents = () =>
  Object.assign(new NodeEvents.EventEmitter(), {
    loadURL: vi.fn((_url: string) => Promise.resolve()),
    isDestroyed: () => false,
  });

const makeFakeWindow = (options: Electron.BrowserWindowConstructorOptions) => {
  let destroyed = false;
  const window = Object.assign(new NodeEvents.EventEmitter(), {
    options,
    webContents: makeFakeWebContents(),
    isDestroyed: () => destroyed,
    focus: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(() => {
      destroyed = true;
      window.emit("closed");
    }),
    closeFake: () => {
      destroyed = true;
      window.emit("closed");
    },
  });
  return window;
};

type FakeWindow = ReturnType<typeof makeFakeWindow>;

const asWebContents = (contents: unknown) => contents as Electron.WebContents;
const asWindow = (window: unknown) => window as Electron.BrowserWindow;

const setup = () => {
  const created: Array<FakeWindow> = [];
  const registry = makeExtensionWindowRegistry((options) => {
    const window = makeFakeWindow(options);
    created.push(window);
    return asWindow(window);
  });
  const addTab = vi.fn<(tab: Electron.WebContents, window: Electron.BaseWindow) => void>();
  const browserSession = {} as Electron.Session;
  const callbacks = registry.callbacksFor(browserSession, () => ({ addTab }));
  return { registry, callbacks, created, addTab, browserSession };
};

const fakeFor = (created: ReadonlyArray<FakeWindow>, window: Electron.BaseWindow) => {
  const fake = created.find((candidate) => asWindow(candidate) === window);
  assert.isDefined(fake);
  return fake;
};

describe("ChromeExtensions window registry", () => {
  it("closeAll should destroy every extension window when the main window closes", async () => {
    const { registry, callbacks, created, browserSession } = setup();
    await callbacks.createTab({ url: "https://example.com/" });
    await callbacks.createWindow({ url: "https://example.com/popup" });

    registry.closeAll();

    assert.strictEqual(created.length, 2);
    for (const window of created) {
      assert.strictEqual(window.destroy.mock.calls.length, 1);
      assert.strictEqual(window.options.webPreferences?.session, browserSession);
    }
  });

  it("closeAll should skip a window that already closed itself", async () => {
    const { registry, callbacks, created } = setup();
    const [, window] = await callbacks.createTab({ url: "https://example.com/" });
    fakeFor(created, window).closeFake();

    registry.closeAll();

    assert.strictEqual(fakeFor(created, window).destroy.mock.calls.length, 0);
  });

  it("removeTab should leave an app tab open and untracked when an extension removes it", () => {
    const { callbacks, addTab } = setup();
    const appTab = makeFakeWebContents();
    const mainWindow = makeFakeWindow({});

    callbacks.removeTab(asWebContents(appTab), asWindow(mainWindow));

    assert.strictEqual(addTab.mock.calls.length, 0);
    assert.strictEqual(mainWindow.close.mock.calls.length, 0);
    assert.strictEqual(mainWindow.destroy.mock.calls.length, 0);
  });

  it("removeTab should close the extension window when the tab lives in one", async () => {
    const { callbacks, created, addTab } = setup();
    const [tab, window] = await callbacks.createTab({ url: "https://example.com/" });

    callbacks.removeTab(tab, window);

    assert.strictEqual(fakeFor(created, window).close.mock.calls.length, 1);
    assert.strictEqual(addTab.mock.calls.length, 0);
  });

  it("removeWindow should leave a window alone when the registry did not open it", () => {
    const { callbacks } = setup();
    const mainWindow = makeFakeWindow({});

    callbacks.removeWindow(asWindow(mainWindow));

    assert.strictEqual(mainWindow.close.mock.calls.length, 0);
    assert.strictEqual(mainWindow.destroy.mock.calls.length, 0);
  });

  it("createWindow should not load the URL when it uses the javascript or chrome scheme", async () => {
    const { callbacks, created, addTab } = setup();
    await callbacks.createWindow({ url: "javascript:alert(1)" });
    await callbacks.createWindow({ url: ["chrome://settings", "https://example.com/"] });
    await callbacks.createWindow({ url: "https://example.com/", width: 400, height: 300 });

    assert.deepStrictEqual(
      created.map((window) => window.webContents.loadURL.mock.calls),
      [[], [["https://example.com/"]], [["https://example.com/"]]],
    );
    assert.deepStrictEqual(
      created.map(({ options }) => ({ width: options.width, height: options.height })),
      [EXTENSION_WINDOW_SIZE, EXTENSION_WINDOW_SIZE, { width: 400, height: 300 }],
    );
    assert.strictEqual(addTab.mock.calls.length, 3);
  });

  it("createWindow should load every URL in its own window when the extension passes several", async () => {
    const { callbacks, created, addTab } = setup();
    const window = await callbacks.createWindow({
      url: ["chrome-extension://a/one.html", "chrome-extension://a/two.html"],
      width: 400,
      height: 300,
    });

    assert.deepStrictEqual(
      created.map((candidate) => candidate.webContents.loadURL.mock.calls),
      [[["chrome-extension://a/one.html"]], [["chrome-extension://a/two.html"]]],
    );
    assert.strictEqual(window, asWindow(created[0]));
    assert.deepStrictEqual(
      addTab.mock.calls,
      created.map((candidate) => [asWebContents(candidate.webContents), asWindow(candidate)]),
    );
    assert.deepStrictEqual(
      created.map(({ options }) => ({ width: options.width, height: options.height })),
      [
        { width: 400, height: 300 },
        { width: 400, height: 300 },
      ],
    );
  });

  it("owns should return true when an extension opens a window after the main window closed", async () => {
    const { registry, callbacks } = setup();
    registry.closeAll();
    const [, window] = await callbacks.createTab({ url: "https://example.com/" });

    assert.isTrue(registry.owns(window));
    assert.isFalse(registry.owns(asWindow(makeFakeWindow({}))));
  });

  it("closeAll should destroy a window when an extension window opened it with window.open", async () => {
    const { registry, callbacks, created } = setup();
    const [, window] = await callbacks.createTab({ url: "chrome-extension://a/welcome.html" });
    const child = makeFakeWindow({});
    const grandchild = makeFakeWindow({});
    fakeFor(created, window).webContents.emit("did-create-window", child);
    child.webContents.emit("did-create-window", grandchild);

    assert.isTrue(registry.owns(asWindow(child)));
    assert.isTrue(registry.owns(asWindow(grandchild)));
    registry.closeAll();

    assert.strictEqual(child.destroy.mock.calls.length, 1);
    assert.strictEqual(grandchild.destroy.mock.calls.length, 1);
  });
});

const EXTENSION_ID = "a".repeat(32);

const makeFakeExtensions = () => {
  const activations: Array<{ readonly eventType: string; readonly anchorRect: unknown }> = [];
  const handlers = new Map([
    [
      "browserAction.activate",
      {
        callback: (_event: unknown, details: (typeof activations)[number]) => {
          activations.push(details);
        },
      },
    ],
  ]);
  const extensions = Object.assign(new NodeEvents.EventEmitter(), {
    ctx: { router: { handlers } },
    selectTab: vi.fn<(tab: Electron.WebContents) => void>(),
  });
  return { extensions, activations, handlers };
};

const makeToolbar = (zoomFactor = 1) => ({ getZoomFactor: () => zoomFactor });

// Mirrors ECE's PopupView: its own blur handler (maybeClose) is registered before
// `browser-action-popup-created` fires.
const makeFakePopup = (options: { readonly closesOnBlur: boolean }) => {
  let destroyed = false;
  const browserWindow = new NodeEvents.EventEmitter();
  const popup = {
    extensionId: EXTENSION_ID,
    browserWindow,
    parent: { webContents: makeToolbar(1.5) },
    anchorRect: { x: 1336, y: 0, width: 64, height: 64 },
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true;
      browserWindow.emit("closed");
    },
  };
  browserWindow.on("blur", () => {
    if (options.closesOnBlur) popup.destroy();
  });
  return popup;
};

const setupToolbar = () => {
  let now = 1_000;
  const browserSession = {} as Electron.Session;
  const fake = makeFakeExtensions();
  installToolbarFixes(
    browserSession,
    fake.extensions as unknown as ChromeExtensionsModule.ElectronChromeExtensions,
    makePopupReclickGuard(() => now),
  );
  const activate = (sender: unknown, details: Record<string, unknown>) =>
    fake.handlers.get("browserAction.activate")?.callback({ type: "frame", sender }, {
      eventType: "click",
      extensionId: EXTENSION_ID,
      tabId: -1,
      anchorRect: { x: 100, y: 10, width: 20, height: 20 },
      ...details,
    } as never);
  return {
    ...fake,
    browserSession,
    activate,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

describe("ChromeExtensions toolbar fixes", () => {
  it("activate should scale the anchor by the app zoom when the toolbar window is zoomed", () => {
    const { activate, activations } = setupToolbar();
    activate(makeToolbar(1.5), { eventType: "click" });
    activate(makeToolbar(1.5), { eventType: "contextmenu" });

    assert.deepStrictEqual(
      activations.map(({ anchorRect }) => anchorRect),
      [
        { x: 150, y: 15, width: 30, height: 30 },
        { x: 150, y: 15, width: 30, height: 30 },
      ],
    );
  });

  it("browser-action-popup-created should keep the anchor when chrome.action.openPopup opened the popup", () => {
    const { extensions } = setupToolbar();
    const popup = makeFakePopup({ closesOnBlur: true });
    extensions.emit("browser-action-popup-created", popup);

    assert.deepStrictEqual(popup.anchorRect, { x: 1336, y: 0, width: 64, height: 64 });
  });

  it("activate should select the tab when the toolbar window hosts it", () => {
    const { activate, extensions, browserSession } = setupToolbar();
    const toolbar = makeToolbar();
    const tab = { id: 41, session: browserSession, hostWebContents: toolbar };
    electronFakes.webContentsById.set(tab.id, tab);
    activate(toolbar, { tabId: tab.id });

    assert.deepStrictEqual(extensions.selectTab.mock.calls, [[asWebContents(tab)]]);
  });

  it("activate should not select the tab when the sender does not host it", () => {
    const { activate, activations, extensions, browserSession } = setupToolbar();
    const tab = { id: 42, session: browserSession, hostWebContents: makeToolbar() };
    electronFakes.webContentsById.set(tab.id, tab);
    activate(makeToolbar(), { tabId: tab.id });

    assert.strictEqual(extensions.selectTab.mock.calls.length, 0);
    assert.strictEqual(activations.length, 1);
  });

  it("activate should swallow the click when the popup closed on blur within the reclick window", () => {
    const { activate, activations, extensions, advance } = setupToolbar();
    const popup = makeFakePopup({ closesOnBlur: true });
    extensions.emit("browser-action-popup-created", popup);
    popup.browserWindow.emit("blur");
    advance(POPUP_RECLICK_WINDOW_MS);
    activate(makeToolbar(), {});

    assert.strictEqual(activations.length, 0);
  });

  it("activate should open the popup when the popup closed without losing focus within the reclick window", () => {
    const { activate, activations, extensions } = setupToolbar();
    const toggled = makeFakePopup({ closesOnBlur: false });
    extensions.emit("browser-action-popup-created", toggled);
    // Focus was outside the app, so ECE kept the popup open on blur and later
    // closed it through its own toggle.
    toggled.browserWindow.emit("blur");
    toggled.destroy();
    activate(makeToolbar(), {});

    assert.strictEqual(activations.length, 1);
  });
});

describe("ChromeExtensions popup reclick guard", () => {
  const setupGuard = () => {
    let now = 1_000;
    const guard = makePopupReclickGuard(() => now);
    return {
      guard,
      advance: (ms: number) => {
        now += ms;
      },
    };
  };

  it("consumeIfJustClosed should return true when the same extension popup closed within the reclick window", () => {
    const { guard, advance } = setupGuard();
    guard.recordClosed("extension-a");
    advance(POPUP_RECLICK_WINDOW_MS);

    assert.isTrue(guard.consumeIfJustClosed("extension-a"));
    assert.isFalse(guard.consumeIfJustClosed("extension-a"));
  });

  it("consumeIfJustClosed should return false when a different extension was clicked", () => {
    const { guard } = setupGuard();
    guard.recordClosed("extension-a");

    assert.isFalse(guard.consumeIfJustClosed("extension-b"));
  });

  it("consumeIfJustClosed should return false when the reclick window has elapsed", () => {
    const { guard, advance } = setupGuard();
    guard.recordClosed("extension-a");
    advance(POPUP_RECLICK_WINDOW_MS + 1);

    assert.isFalse(guard.consumeIfJustClosed("extension-a"));
  });
});
