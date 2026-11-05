// @effect-diagnostics nodeBuiltinImport:off -- The patched library finds native hosts through real manifest files on disk.
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

type IpcHandler = (event: unknown, ...args: ReadonlyArray<unknown>) => unknown;

const iconFixture = vi.hoisted(() => ({
  paths: new Set([
    "/nonexistent-extension/assets/green-38.png",
    "/nonexistent-extension/assets/green 38.png",
  ]),
  bytes: new TextEncoder().encode("png-bytes"),
}));

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  listeners: new Map<string, IpcHandler>(),
  partitions: new Map<string, unknown>(),
}));

const nativeHosts = vi.hoisted(() => ({
  userData: "/nonexistent-user-data",
  spawned: [] as Array<{ readonly kill: () => void; readonly killed: () => boolean }>,
  // What the fake host does once it is written to: reply with a message, or exit.
  onWrite: undefined as { readonly reply: unknown } | "exit" | undefined,
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    spawn: () => {
      let killed = false;
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        stdin: {
          write: () => {
            const onWrite = nativeHosts.onWrite;
            queueMicrotask(() => {
              if (onWrite === "exit") {
                child.emit("exit", 1);
              } else if (onWrite !== undefined) {
                const body = Buffer.from(JSON.stringify(onWrite.reply));
                const length = Buffer.alloc(4);
                length.writeUInt32LE(body.length, 0);
                child.stdout.emit("data", Buffer.concat([length, body]));
              }
            });
            return true;
          },
        },
        kill: () => {
          killed = true;
          return true;
        },
      });
      nativeHosts.spawned.push({ kill: child.kill, killed: () => killed });
      return child;
    },
  };
});

vi.mock("electron", () => {
  const windowClass = { getAllWindows: () => [], fromWebContents: () => null };
  return {
    app: {
      isReady: () => true,
      on: () => undefined,
      getAppPath: () => "/nonexistent-app",
      getPath: () => nativeHosts.userData,
      name: "Test App",
    },
    ipcMain: {
      handle: (channel: string, handler: IpcHandler) => ipc.handlers.set(channel, handler),
      on: (channel: string, handler: IpcHandler) => ipc.listeners.set(channel, handler),
    },
    session: {
      defaultSession: undefined,
      fromPartition: (partition: string) => ipc.partitions.get(partition),
    },
    protocol: { registerSchemesAsPrivileged: () => undefined },
    BrowserWindow: windowClass,
    BaseWindow: windowClass,
    webContents: { fromId: () => undefined, getAllWebContents: () => [] },
    webFrameMain: { fromId: () => undefined },
    Menu: vi.fn(),
    MenuItem: vi.fn(),
    nativeImage: {
      // Mirrors Electron: only a path that holds an image yields a non-empty one.
      createFromPath: (imagePath: string) => {
        const exists = iconFixture.paths.has(imagePath);
        return {
          isEmpty: () => !exists,
          toPNG: () => (exists ? iconFixture.bytes : new Uint8Array()),
        };
      },
      createEmpty: () => undefined,
    },
    Notification: vi.fn(),
  };
});

import { ElectronChromeExtensions } from "electron-chrome-extensions";

const EXTENSION_ID = "a".repeat(32);
const OTHER_EXTENSION_ID = "b".repeat(32);

const makeSession = (permissions: ReadonlyArray<string> = ["storage"]) => {
  const extension = {
    id: EXTENSION_ID,
    name: "Example",
    path: "/nonexistent-extension",
    url: `chrome-extension://${EXTENSION_ID}/`,
    version: "1.0.0",
    manifest: {
      manifest_version: 3,
      name: "Example",
      version: "1.0.0",
      permissions,
      action: { default_title: "Example" },
    },
  };
  const extensions = Object.assign(new NodeEvents.EventEmitter(), {
    getAllExtensions: () => [extension],
    getExtension: (id: string) => (id === EXTENSION_ID ? extension : null),
  });
  const serviceWorkers = Object.assign(new NodeEvents.EventEmitter(), {
    getWorkerFromVersionID: () => undefined,
  });
  return {
    extensions,
    serviceWorkers,
    cookies: new NodeEvents.EventEmitter(),
    registerPreloadScript: () => undefined,
    isPersistent: () => true,
    protocol: {
      isProtocolHandled: () => false,
      handle: () => undefined,
      unhandle: () => undefined,
    },
  };
};

type FakeSession = ReturnType<typeof makeSession>;

const makeFakeWindow = () =>
  Object.assign(new NodeEvents.EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    isFocused: () => false,
    isMaximized: () => false,
    isMinimized: () => false,
    isFullScreen: () => false,
    isAlwaysOnTop: () => false,
    getPosition: () => [0, 0],
    getSize: () => [900, 700],
  });

const setup = (permissions?: ReadonlyArray<string>) => {
  ipc.partitions.clear();
  const session = makeSession(permissions);
  const createdWindows: Array<unknown> = [];
  const extensions = new ElectronChromeExtensions({
    license: "GPL-3.0",
    session: session as unknown as Electron.Session,
    createWindow: async (details) => {
      createdWindows.push(details);
      return makeFakeWindow() as unknown as Electron.BaseWindow;
    },
  });
  return { session, extensions, createdWindows };
};

type SenderType = "window" | "webview";

const frameEvent = (
  session: FakeSession,
  url: string | null,
  senderType: SenderType = "window",
) => ({
  type: "frame",
  sender: Object.assign(new NodeEvents.EventEmitter(), {
    id: 1,
    ipc: new NodeEvents.EventEmitter(),
    session,
    getURL: () => url ?? "",
    getType: () => senderType,
    isDestroyed: () => false,
  }),
  senderFrame: url === null ? null : { url },
});

const serviceWorkerEvent = (session: FakeSession, scope: string) => ({
  type: "service-worker",
  session,
  serviceWorker: { scope, versionId: 1, ipc: new NodeEvents.EventEmitter() },
});

const handler = (channel: string) => {
  const registered = ipc.handlers.get(channel) ?? ipc.listeners.get(channel);
  assert.isDefined(registered, `${channel} is not registered`);
  return registered;
};

const routerListeners = (extensions: ElectronChromeExtensions) =>
  (extensions as unknown as { ctx: { router: { listeners: Map<string, unknown> } } }).ctx.router
    .listeners;

const rejectionOf = async (promise: unknown) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
};

describe("electron-chrome-extensions sender patch", () => {
  it("crx-msg should reject when a web page frame claims an extension id", async () => {
    const { session } = setup();
    const error = await rejectionOf(
      handler("crx-msg")(
        frameEvent(session, "https://evil.example/"),
        EXTENSION_ID,
        "permissions.getAll",
      ),
    );
    assert.instanceOf(error, Error);
    assert.include(error.message, `does not belong to extension ${EXTENSION_ID}`);
  });

  it("crx-msg should reject when the sender frame is null", async () => {
    const { session } = setup();
    const error = await rejectionOf(
      handler("crx-msg")(frameEvent(session, null), EXTENSION_ID, "permissions.getAll"),
    );
    assert.instanceOf(error, Error);
    assert.include(error.message, `does not belong to extension ${EXTENSION_ID}`);
  });

  it("crx-msg should reject when a service worker scope belongs to another extension", async () => {
    const { session } = setup();
    const error = await rejectionOf(
      handler("crx-msg")(
        serviceWorkerEvent(session, `chrome-extension://${OTHER_EXTENSION_ID}/`),
        EXTENSION_ID,
        "permissions.getAll",
      ),
    );
    assert.instanceOf(error, Error);
    assert.include(error.message, `does not belong to extension ${EXTENSION_ID}`);
  });

  it("crx-msg should run the handler when the frame is the extension's own page", async () => {
    const { session } = setup();
    const result = await handler("crx-msg")(
      frameEvent(session, `chrome-extension://${EXTENSION_ID}/popup.html`),
      EXTENSION_ID,
      "permissions.getAll",
    );
    assert.deepStrictEqual(result, { permissions: ["storage"], origins: [] });
  });

  it("crx-msg should run the handler when the service worker scope belongs to the extension", async () => {
    const { session } = setup();
    const result = await handler("crx-msg")(
      serviceWorkerEvent(session, `chrome-extension://${EXTENSION_ID}/`),
      EXTENSION_ID,
      "permissions.getAll",
    );
    assert.deepStrictEqual(result, { permissions: ["storage"], origins: [] });
  });

  it("crx-msg-remote should run the handler when the app window sends no extension id", async () => {
    const { session } = setup();
    const result = await handler("crx-msg-remote")(
      frameEvent(session, "https://app.example/"),
      "_self",
      "browserAction.getState",
    );
    assert.deepStrictEqual(result, { activeTabId: undefined, actions: [] });
  });

  it("crx-msg-remote should reject when a browser tab sends no extension id", async () => {
    const { session } = setup();
    const error = await rejectionOf(
      handler("crx-msg-remote")(
        frameEvent(session, "https://evil.example/", "webview"),
        "_self",
        "browserAction.getState",
      ),
    );
    assert.instanceOf(error, Error);
    assert.include(error.message, "only the app window");
  });

  it("crx-msg-remote should reject when an incognito browser tab targets a persistent profile", async () => {
    const { session } = setup();
    ipc.partitions.set("persist:profile", session);
    const incognitoSession = makeSession();
    const error = await rejectionOf(
      handler("crx-msg-remote")(
        frameEvent(incognitoSession, "https://evil.example/", "webview"),
        "persist:profile",
        "browserAction.getState",
      ),
    );
    assert.instanceOf(error, Error);
    assert.include(error.message, "only the app window");
  });

  it("crx-msg should reject when a browser tab sends no extension id", async () => {
    const { session } = setup();
    const error = await rejectionOf(
      handler("crx-msg")(
        frameEvent(session, "https://evil.example/", "webview"),
        undefined,
        "browserAction.getState",
      ),
    );
    assert.instanceOf(error, Error);
    assert.include(error.message, "only the app window");
  });

  it("crx-msg should check the sender origin when the extension id is an empty string", async () => {
    const { session } = setup();
    for (const senderType of ["window", "webview"] as const) {
      const error = await rejectionOf(
        handler("crx-msg")(
          frameEvent(session, "https://evil.example/", senderType),
          "",
          "browserAction.getState",
        ),
      );
      assert.instanceOf(error, Error);
      assert.include(error.message, "does not belong to extension");
    }
  });

  it("crx-add-listener should store no listener when a browser tab sends no extension id", () => {
    const { session, extensions } = setup();
    assert.doesNotThrow(() =>
      handler("crx-add-listener")(
        frameEvent(session, "https://evil.example/", "webview"),
        undefined,
        "tabs.onUpdated",
      ),
    );
    assert.isFalse(routerListeners(extensions).has("tabs.onUpdated"));
  });

  it("crx-add-listener should store no listener when a web page frame claims an extension id", () => {
    const { session, extensions } = setup();
    handler("crx-add-listener")(
      frameEvent(session, "https://evil.example/"),
      EXTENSION_ID,
      "tabs.onUpdated",
    );
    assert.isFalse(routerListeners(extensions).has("tabs.onUpdated"));
  });

  it("crx-add-listener should store the listener when the frame is the extension's own page", () => {
    const { session, extensions } = setup();
    handler("crx-add-listener")(
      frameEvent(session, `chrome-extension://${EXTENSION_ID}/popup.html`),
      EXTENSION_ID,
      "tabs.onUpdated",
    );
    assert.isTrue(routerListeners(extensions).has("tabs.onUpdated"));
  });

  it("crx-remove-listener should keep the listener when a web page frame claims an extension id", () => {
    const { session, extensions } = setup();
    const trusted = frameEvent(session, `chrome-extension://${EXTENSION_ID}/popup.html`);
    handler("crx-add-listener")(trusted, EXTENSION_ID, "tabs.onUpdated");
    // Same host webContents, so only the sender check tells the two events apart.
    const forged = { ...trusted, senderFrame: { url: "https://evil.example/" } };
    handler("crx-remove-listener")(forged, EXTENSION_ID, "tabs.onUpdated");
    assert.isTrue(routerListeners(extensions).has("tabs.onUpdated"));
  });

  it("crx-remove-listener should remove the listener when the frame is the extension's own page", () => {
    const { session, extensions } = setup();
    const trusted = frameEvent(session, `chrome-extension://${EXTENSION_ID}/popup.html`);
    handler("crx-add-listener")(trusted, EXTENSION_ID, "tabs.onUpdated");
    handler("crx-remove-listener")(trusted, EXTENSION_ID, "tabs.onUpdated");
    assert.isFalse(routerListeners(extensions).has("tabs.onUpdated"));
  });
});

describe("electron-chrome-extensions windows.create patch", () => {
  it("windows.create should resolve every URL against the extension when the extension passes relative URLs", async () => {
    const { session, createdWindows } = setup();
    const extensionPage = frameEvent(session, `chrome-extension://${EXTENSION_ID}/background.html`);
    await handler("crx-msg")(extensionPage, EXTENSION_ID, "windows.create", { url: "popup.html" });
    await handler("crx-msg")(extensionPage, EXTENSION_ID, "windows.create", {
      url: ["/welcome.html", "https://example.com/"],
      width: 400,
    });
    assert.deepStrictEqual(createdWindows, [
      { url: `chrome-extension://${EXTENSION_ID}/popup.html` },
      {
        url: [`chrome-extension://${EXTENSION_ID}/welcome.html`, "https://example.com/"],
        width: 400,
      },
    ]);
  });

  it("windows.create should reject when a URL uses the javascript scheme", async () => {
    const { session, createdWindows } = setup();
    const error = await rejectionOf(
      handler("crx-msg")(
        frameEvent(session, `chrome-extension://${EXTENSION_ID}/background.html`),
        EXTENSION_ID,
        "windows.create",
        { url: ["https://example.com/", "javascript:alert(1)"] },
      ),
    );
    assert.instanceOf(error, Error);
    assert.deepStrictEqual(createdWindows, []);
  });

  const requestIconAfterSetIcon = async (iconPath: string) => {
    const { session } = setup();
    await handler("crx-msg")(
      serviceWorkerEvent(session, `chrome-extension://${EXTENSION_ID}/`),
      EXTENSION_ID,
      "browserAction.setIcon",
      { path: { "38": iconPath } },
    );
    const crxHandlers = new Map<string, (request: Request) => Promise<Response>>();
    Object.assign(session.protocol, {
      handle: (scheme: string, crxHandler: (request: Request) => Promise<Response>) =>
        crxHandlers.set(scheme, crxHandler),
    });
    ElectronChromeExtensions.handleCRXProtocol(session as unknown as Electron.Session);
    const crxHandler = crxHandlers.get("crx");
    assert.isDefined(crxHandler);
    const response = await crxHandler(
      new Request(`crx://extension-icon/${EXTENSION_ID}/38/1?partition=_self`),
    );
    return { status: response.status, body: await response.text() };
  };

  it("extension-icon should serve the icon when setIcon used an absolute chrome-extension url", async () => {
    const response = await requestIconAfterSetIcon(
      `chrome-extension://${EXTENSION_ID}/assets/green-38.png`,
    );
    assert.deepStrictEqual(response, { status: 200, body: "png-bytes" });
  });

  it("extension-icon should serve the icon when the absolute url carries a query and hash", async () => {
    const response = await requestIconAfterSetIcon(
      `chrome-extension://${EXTENSION_ID}/assets/green-38.png?v=2#top`,
    );
    assert.deepStrictEqual(response, { status: 200, body: "png-bytes" });
  });

  it("extension-icon should serve the icon when the absolute url percent-encodes the file name", async () => {
    const response = await requestIconAfterSetIcon(
      `chrome-extension://${EXTENSION_ID}/assets/green%2038.png`,
    );
    assert.deepStrictEqual(response, { status: 200, body: "png-bytes" });
  });

  it("extension-icon should keep the path inside the extension when the absolute url encodes parent segments", async () => {
    // Clamped to the extension root, `/x/%2e%2e/%2e%2e/assets/...` can only name the in-root icon.
    const response = await requestIconAfterSetIcon(
      `chrome-extension://${EXTENSION_ID}/x/%2e%2e/%2e%2e/assets/green-38.png`,
    );
    assert.deepStrictEqual(response, { status: 200, body: "png-bytes" });
  });

  it("extension-icon should not serve another extension's file when setIcon used its absolute url", async () => {
    const response = await requestIconAfterSetIcon(
      `chrome-extension://${OTHER_EXTENSION_ID}/assets/green-38.png`,
    );
    assert.notStrictEqual(response.body, "png-bytes");
  });
});

const NATIVE_HOST = "com.example.host";

const nativeHostFixture = () => {
  nativeHosts.spawned.length = 0;
  nativeHosts.onWrite = undefined;
  const userData = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-native-host-"));
  nativeHosts.userData = userData;
  const hostPath = NodePath.join(userData, "host");
  NodeFS.writeFileSync(hostPath, "");
  NodeFS.mkdirSync(NodePath.join(userData, "NativeMessagingHosts"));
  NodeFS.writeFileSync(
    NodePath.join(userData, "NativeMessagingHosts", `${NATIVE_HOST}.json`),
    JSON.stringify({
      name: NATIVE_HOST,
      description: "Example host",
      path: hostPath,
      type: "stdio",
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    }),
  );
  const { session, extensions } = setup(["nativeMessaging"]);
  const hostReady = (connectionId: string) =>
    (
      extensions as unknown as {
        api: { runtime: { hostMap: Record<string, { ready: Promise<void> } | undefined> } };
      }
    ).api.runtime.hostMap[connectionId]?.ready;
  return {
    session,
    hostReady,
    [Symbol.dispose]: () => {
      nativeHosts.userData = "/nonexistent-user-data";
      NodeFS.rmSync(userData, { recursive: true, force: true });
    },
  };
};

describe("electron-chrome-extensions native messaging patch", () => {
  it("connectNative should kill the host when the connecting service worker stops", async () => {
    using fixture = nativeHostFixture();
    const worker = serviceWorkerEvent(fixture.session, `chrome-extension://${EXTENSION_ID}/`);
    await handler("crx-msg")(worker, EXTENSION_ID, "runtime.connectNative", "port-1", NATIVE_HOST);
    await fixture.hostReady("port-1");
    assert.lengthOf(nativeHosts.spawned, 1);
    fixture.session.serviceWorkers.emit("running-status-changed", {
      versionId: worker.serviceWorker.versionId,
      runningStatus: "stopped",
    });
    assert.isTrue(nativeHosts.spawned[0]?.killed());
  });

  it("connectNative should not spawn the host when the service worker stops before the host launches", async () => {
    using fixture = nativeHostFixture();
    const worker = serviceWorkerEvent(fixture.session, `chrome-extension://${EXTENSION_ID}/`);
    await handler("crx-msg")(worker, EXTENSION_ID, "runtime.connectNative", "port-1", NATIVE_HOST);
    const launched = fixture.hostReady("port-1");
    fixture.session.serviceWorkers.emit("running-status-changed", {
      versionId: worker.serviceWorker.versionId,
      runningStatus: "stopped",
    });
    await launched;
    assert.lengthOf(nativeHosts.spawned, 0);
  });

  it("sendNativeMessage should kill the host when the host has replied", async () => {
    using fixture = nativeHostFixture();
    nativeHosts.onWrite = { reply: { pong: true } };
    const worker = serviceWorkerEvent(fixture.session, `chrome-extension://${EXTENSION_ID}/`);
    const response = await handler("crx-msg")(
      worker,
      EXTENSION_ID,
      "runtime.sendNativeMessage",
      NATIVE_HOST,
      { ping: true },
    );
    assert.deepStrictEqual(response, { pong: true });
    assert.isTrue(nativeHosts.spawned[0]?.killed());
  });

  it("sendNativeMessage should reject when the host exits without replying", async () => {
    using fixture = nativeHostFixture();
    nativeHosts.onWrite = "exit";
    const worker = serviceWorkerEvent(fixture.session, `chrome-extension://${EXTENSION_ID}/`);
    const error = await rejectionOf(
      handler("crx-msg")(worker, EXTENSION_ID, "runtime.sendNativeMessage", NATIVE_HOST, {
        ping: true,
      }),
    );
    assert.instanceOf(error, Error);
  });

  it("connectNative should kill the host when the connecting extension page is destroyed", async () => {
    using fixture = nativeHostFixture();
    const page = frameEvent(fixture.session, `chrome-extension://${EXTENSION_ID}/popup.html`);
    await handler("crx-msg")(page, EXTENSION_ID, "runtime.connectNative", "port-1", NATIVE_HOST);
    await fixture.hostReady("port-1");
    page.sender.emit("destroyed");
    assert.isTrue(nativeHosts.spawned[0]?.killed());
  });
});
