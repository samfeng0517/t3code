import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { beforeEach, vi } from "vite-plus/test";

const { fromPartition, sessions } = vi.hoisted(() => ({
  fromPartition: vi.fn(),
  sessions: new Map<
    string,
    {
      readonly clearCache: ReturnType<typeof vi.fn>;
      readonly clearStorageData: ReturnType<typeof vi.fn>;
      readonly getUserAgent: ReturnType<typeof vi.fn<() => string>>;
      readonly setPermissionRequestHandler: ReturnType<typeof vi.fn>;
      readonly setPermissionCheckHandler: ReturnType<typeof vi.fn>;
      readonly setUserAgent: ReturnType<typeof vi.fn>;
    }
  >(),
}));

const { fromWebContents } = vi.hoisted(() => ({
  fromWebContents: vi.fn<(webContents: unknown) => unknown>(() => null),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents },
  session: {
    fromPartition,
  },
}));

const { attachChromeExtensions } = vi.hoisted(() => ({
  attachChromeExtensions: vi.fn<(browserSession: unknown) => void>(),
}));

vi.mock("./ChromeExtensions.ts", () => ({ attachChromeExtensions }));

import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as BrowserNotificationPermissions from "./BrowserNotificationPermissions.ts";
import * as BrowserSession from "./BrowserSession.ts";

const { showMessageBox } = vi.hoisted(() => ({
  showMessageBox: vi.fn<
    (
      options: Electron.MessageBoxOptions,
      owner?: Electron.BrowserWindow,
    ) => number | Promise<number>
  >(() => 1),
}));
const layerDialog = Layer.succeed(ElectronDialog.ElectronDialog, {
  pickFolder: () => Effect.die("unused"),
  pickFiles: () => Effect.die("unused"),
  showMessageBox: (options, owner) =>
    Effect.promise(async () => ({
      response: await showMessageBox(options, owner),
      checkboxChecked: false,
    })),
  showErrorBox: () => Effect.void,
});
const notificationDecisions = new Map<string, "allow" | "block">();
const layerNotificationPermissions = Layer.succeed(
  BrowserNotificationPermissions.BrowserNotificationPermissions,
  {
    decisionFor: (origin) => notificationDecisions.get(origin),
    set: (origin, decision) => Effect.sync(() => void notificationDecisions.set(origin, decision)),
    remove: (origin) =>
      Effect.sync(() => {
        notificationDecisions.delete(origin);
        return [];
      }),
    list: Effect.succeed([]),
  },
);
const layer = BrowserSession.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, layerDialog, layerNotificationPermissions)),
);

const notificationRequester = (scope: string, persistent: boolean) =>
  Effect.gen(function* () {
    const browserSessions = yield* BrowserSession.BrowserSession;
    const partition = yield* browserSessions.getPartition(scope, persistent);
    yield* browserSessions.getSession(scope, persistent);
    const requestHandler = sessions.get(partition)?.setPermissionRequestHandler.mock.calls[0]?.[0];
    assert.isFunction(requestHandler);
    return (requestingUrl: string, isMainFrame = true) =>
      Effect.callback<boolean>((resume) => {
        requestHandler(
          null,
          "notifications",
          (granted: boolean) => resume(Effect.succeed(granted)),
          {
            requestingUrl,
            isMainFrame,
          },
        );
      });
  });

describe("BrowserSession", () => {
  beforeEach(() => {
    sessions.clear();
    notificationDecisions.clear();
    attachChromeExtensions.mockReset();
    fromPartition.mockReset();
    fromPartition.mockImplementation((partition: string) => {
      const browserSession = {
        clearCache: vi.fn(() => Promise.resolve()),
        clearStorageData: vi.fn(() => Promise.resolve()),
        getUserAgent: vi.fn(() => "Mozilla/5.0 Electron/41.5.0 t3code/0.0.27"),
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        setUserAgent: vi.fn(),
      };
      sessions.set(partition, browserSession);
      return browserSession;
    });
  });

  it.effect("derives deterministic partitions and memoizes sessions", () =>
    Effect.gen(function* () {
      const browserSessions = yield* BrowserSession.BrowserSession;

      const partition = yield* browserSessions.getPartition("scope-a");
      const first = yield* browserSessions.getSession("scope-a");
      const second = yield* browserSessions.getSession("scope-a");

      assert.strictEqual(partition, "persist:t3code-preview-f051bb2c68cb7b2fe969");
      assert.strictEqual(first, second);
      assert.strictEqual(fromPartition.mock.calls.length, 1);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps scopes that differ only by a lone surrogate in separate partitions", () =>
    Effect.gen(function* () {
      const browserSessions = yield* BrowserSession.BrowserSession;

      const loneSurrogate = yield* browserSessions.getPartition("p\ud800");
      const replacementChar = yield* browserSessions.getPartition("p\ufffd");
      assert.notStrictEqual(loneSurrogate, replacementChar);

      const literal = yield* browserSessions.getPartition("p\\ud800");
      assert.notStrictEqual(literal, loneSurrogate);

      assert.strictEqual(
        yield* browserSessions.getPartition("scope-a"),
        "persist:t3code-preview-f051bb2c68cb7b2fe969",
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps legacy defaults disjoint from nondefault profile partitions", () =>
    Effect.gen(function* () {
      const browserSessions = yield* BrowserSession.BrowserSession;

      const legacyDefault = yield* browserSessions.getPartition("a::b");
      const nondefaultProfile = yield* browserSessions.getPartition("a::b", true, "profile");

      assert.strictEqual(legacyDefault, "persist:t3code-preview-78f0be89237d77f7a70e");
      assert.strictEqual(nondefaultProfile, "persist:t3code-preview-profile-78f0be89237d77f7a70e");
      assert.notStrictEqual(nondefaultProfile, legacyDefault);
      assert.isTrue(browserSessions.isPartition(legacyDefault));
      assert.isTrue(browserSessions.isPartition(nondefaultProfile));
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps the guest's effective User-Agent equal to Electron's native one", () =>
    Effect.gen(function* () {
      const nativeUserAgent =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) T3Code(Alpha)/0.0.33 Chrome/146.0.7680.216 Electron/41.5.0 Safari/537.36";
      fromPartition.mockReset();
      fromPartition.mockImplementation((partition: string) => {
        let userAgent = nativeUserAgent;
        const browserSession = {
          clearCache: vi.fn(() => Promise.resolve()),
          clearStorageData: vi.fn(() => Promise.resolve()),
          getUserAgent: vi.fn(() => userAgent),
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          setUserAgent: vi.fn((next: string) => {
            userAgent = next;
          }),
        };
        sessions.set(partition, browserSession);
        return browserSession;
      });

      const browserSessions = yield* BrowserSession.BrowserSession;
      const partition = yield* browserSessions.getPartition("scope-a");
      yield* browserSessions.getSession("scope-a");

      const browserSession = sessions.get(partition);
      assert.isDefined(browserSession);
      assert.strictEqual(browserSession.getUserAgent(), nativeUserAgent);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("grants clipboard-sanitized-write through both the request and check handlers", () =>
    Effect.gen(function* () {
      const browserSessions = yield* BrowserSession.BrowserSession;
      const partition = yield* browserSessions.getPartition("scope-a");
      yield* browserSessions.getSession("scope-a");

      const browserSession = sessions.get(partition);
      assert.isDefined(browserSession);

      const requestHandler = browserSession.setPermissionRequestHandler.mock.calls[0]?.[0];
      const checkHandler = browserSession.setPermissionCheckHandler.mock.calls[0]?.[0];
      assert.isFunction(requestHandler);
      assert.isFunction(checkHandler);

      const requestAllows = (permission: string): boolean => {
        let granted: boolean | undefined;
        requestHandler(null, permission, (value: boolean) => {
          granted = value;
        });
        assert.isDefined(granted);
        return granted;
      };

      for (const permission of ["clipboard-sanitized-write", "geolocation", "fullscreen"]) {
        assert.isTrue(requestAllows(permission), `request handler should allow ${permission}`);
        assert.isTrue(
          checkHandler(null, permission) as boolean,
          `check handler should allow ${permission}`,
        );
      }

      // `clipboard-write` is not a real Electron permission — the async write API
      // uses `clipboard-sanitized-write` — so the stale name must not be granted,
      // and unrelated permissions stay denied.
      for (const permission of ["clipboard-write", "midi"]) {
        assert.isFalse(requestAllows(permission), `request handler should deny ${permission}`);
        assert.isFalse(
          checkHandler(null, permission) as boolean,
          `check handler should deny ${permission}`,
        );
      }
    }).pipe(Effect.provide(layer)),
  );

  it.effect("opens custom-scheme links externally only after the user confirms", () =>
    Effect.gen(function* () {
      const browserSessions = yield* BrowserSession.BrowserSession;
      const partition = yield* browserSessions.getPartition("scope-a");
      yield* browserSessions.getSession("scope-a");
      const requestHandler =
        sessions.get(partition)?.setPermissionRequestHandler.mock.calls[0]?.[0];
      assert.isFunction(requestHandler);

      const request = (externalURL: string) =>
        Effect.callback<boolean>((resume) => {
          requestHandler(
            null,
            "openExternal",
            (granted: boolean) => resume(Effect.succeed(granted)),
            { externalURL },
          );
        });

      showMessageBox.mockReset();
      showMessageBox.mockReturnValueOnce(0).mockReturnValueOnce(1);
      assert.isTrue(yield* request("slack://open?team=T1"));
      assert.isFalse(yield* request("zoommtg://zoom.us/join"));
      assert.strictEqual(showMessageBox.mock.calls.length, 2);

      for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x"]) {
        assert.isFalse(yield* request(url), `${url} must never open externally`);
      }
      assert.strictEqual(showMessageBox.mock.calls.length, 2);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("asks once per origin before a page reads the clipboard", () =>
    Effect.gen(function* () {
      const browserSessions = yield* BrowserSession.BrowserSession;
      const partition = yield* browserSessions.getPartition("scope-a");
      yield* browserSessions.getSession("scope-a");
      const browserSession = sessions.get(partition);
      assert.isDefined(browserSession);
      const requestHandler = browserSession.setPermissionRequestHandler.mock.calls[0]?.[0];
      const checkHandler = browserSession.setPermissionCheckHandler.mock.calls[0]?.[0];
      assert.isFunction(requestHandler);
      assert.isFunction(checkHandler);

      const readClipboard = (requestingUrl: string) =>
        Effect.callback<boolean>((resume) => {
          requestHandler(
            null,
            "clipboard-read",
            (granted: boolean) => resume(Effect.succeed(granted)),
            { requestingUrl, isMainFrame: true },
          );
        });
      const checkClipboard = (origin: string): boolean =>
        checkHandler(null, "clipboard-read", origin, {}) as boolean;

      showMessageBox.mockReset();
      showMessageBox.mockReturnValueOnce(0).mockReturnValueOnce(1);

      assert.isFalse(checkClipboard("https://allowed.test"));
      assert.isTrue(yield* readClipboard("https://allowed.test/page"));
      assert.strictEqual(showMessageBox.mock.calls.length, 1);
      assert.strictEqual(
        showMessageBox.mock.calls[0]?.[0].message,
        "https://allowed.test wants to see text and images copied to the clipboard",
      );
      assert.deepStrictEqual(showMessageBox.mock.calls[0]?.[0].buttons, ["Allow", "Block"]);
      // Enter must not accept a prompt the page raised while the user was typing.
      assert.strictEqual(showMessageBox.mock.calls[0]?.[0].defaultId, 1);

      assert.isTrue(yield* readClipboard("https://allowed.test/other"));
      assert.isTrue(checkClipboard("https://allowed.test"));

      assert.isFalse(yield* readClipboard("https://blocked.test/"));
      assert.isFalse(yield* readClipboard("https://blocked.test/again"));
      assert.isFalse(checkClipboard("https://blocked.test"));
      assert.isTrue(checkClipboard("https://allowed.test"));
      assert.strictEqual(showMessageBox.mock.calls.length, 2);
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "should ask once per site and remember the answer when a page requests notifications",
    () =>
      Effect.gen(function* () {
        const browserSessions = yield* BrowserSession.BrowserSession;
        const partition = yield* browserSessions.getPartition("scope-a");
        yield* browserSessions.getSession("scope-a");
        const browserSession = sessions.get(partition);
        const requestHandler = browserSession?.setPermissionRequestHandler.mock.calls[0]?.[0];
        const checkHandler = browserSession?.setPermissionCheckHandler.mock.calls[0]?.[0];
        assert.isFunction(requestHandler);
        assert.isFunction(checkHandler);
        const request = (requestingUrl: string) =>
          Effect.callback<boolean>((resume) => {
            requestHandler(
              null,
              "notifications",
              (granted: boolean) => resume(Effect.succeed(granted)),
              {
                requestingUrl,
              },
            );
          });

        showMessageBox.mockReset();
        showMessageBox.mockReturnValueOnce(0).mockReturnValueOnce(1);
        assert.isTrue(yield* request("https://chat.example.com/inbox"));
        assert.isTrue(yield* request("https://chat.example.com/other"));
        assert.isFalse(yield* request("https://ads.example.com/"));
        assert.isFalse(yield* request("https://ads.example.com/again"));
        assert.strictEqual(showMessageBox.mock.calls.length, 2);
        assert.include(showMessageBox.mock.calls[0]?.[0].message, "https://chat.example.com");

        assert.isTrue(checkHandler(null, "notifications", "https://chat.example.com") as boolean);
        assert.isFalse(checkHandler(null, "notifications", "https://ads.example.com") as boolean);
        assert.isFalse(checkHandler(null, "notifications", "https://new.example.com") as boolean);
      }).pipe(Effect.provide(layer)),
  );

  it.effect("should not ask again in this run when the notification prompt is dismissed", () =>
    Effect.gen(function* () {
      const request = yield* notificationRequester("scope-a", true);

      showMessageBox.mockReset();
      showMessageBox.mockReturnValue(2);
      assert.isFalse(yield* request("https://chat.example.com/"));
      assert.isFalse(yield* request("https://chat.example.com/"));
      assert.strictEqual(showMessageBox.mock.calls.length, 1);
      assert.isUndefined(notificationDecisions.get("https://chat.example.com"));
      assert.isFalse(yield* request("file:///tmp/page.html"));
      assert.strictEqual(showMessageBox.mock.calls.length, 1);
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "should deny without asking when an embedded frame or an incognito page requests notifications",
    () =>
      Effect.gen(function* () {
        const request = yield* notificationRequester("scope-a", true);
        const incognito = yield* notificationRequester("scope-b", false);

        showMessageBox.mockReset();
        showMessageBox.mockReturnValue(0);
        assert.isFalse(yield* request("https://ads.example.com/", false));
        assert.isFalse(yield* incognito("https://chat.example.com/"));
        assert.strictEqual(showMessageBox.mock.calls.length, 0);

        notificationDecisions.set("https://chat.example.com", "allow");
        assert.isFalse(yield* incognito("https://chat.example.com/"));
      }).pipe(Effect.provide(layer)),
  );

  it.effect("should deny another site's request while a notification prompt is open", () =>
    Effect.gen(function* () {
      const browserSessions = yield* BrowserSession.BrowserSession;
      const partition = yield* browserSessions.getPartition("scope-a");
      yield* browserSessions.getSession("scope-a");
      const requestHandler =
        sessions.get(partition)?.setPermissionRequestHandler.mock.calls[0]?.[0];
      assert.isFunction(requestHandler);
      let release: (response: number) => void = () => {};
      showMessageBox.mockReset();
      showMessageBox.mockImplementation(
        () =>
          new Promise<number>((resolve) => {
            release = resolve;
          }),
      );
      const answer = (requestingUrl: string) =>
        new Promise<boolean>((resolve) => {
          requestHandler(null, "notifications", resolve, { requestingUrl, isMainFrame: true });
        });

      const first = answer("https://a.example.com/");
      const other = answer("https://b.example.com/");
      const sameSite = answer("https://a.example.com/x");
      assert.isFalse(yield* Effect.promise(() => other));
      assert.strictEqual(showMessageBox.mock.calls.length, 1);

      release(0);
      assert.isTrue(yield* Effect.promise(() => first));
      assert.isTrue(yield* Effect.promise(() => sameSite));
    }).pipe(Effect.provide(layer)),
  );

  it.effect("clears a partition whose session has not been opened yet", () =>
    Effect.gen(function* () {
      const browserSessions = yield* BrowserSession.BrowserSession;
      const partition = yield* browserSessions.getPartition("scope-untouched");

      assert.isUndefined(sessions.get(partition));
      yield* browserSessions.clearCookies([partition]);
      assert.isUndefined(sessions.get(partition));

      yield* browserSessions.getSession("scope-untouched");
      yield* browserSessions.clearCookies([partition]);

      const created = sessions.get(partition);
      assert.isDefined(created);
      assert.strictEqual(created.clearStorageData.mock.calls.length, 1);
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "getSession should attach chrome extensions before persistent session initializers run when it creates the session",
    () =>
      Effect.gen(function* () {
        const browserSessions = yield* BrowserSession.BrowserSession;
        const attachCallsAtInitialization: Array<number> = [];
        yield* browserSessions.addPersistentSessionInitializer(() =>
          Effect.sync(() => {
            attachCallsAtInitialization.push(attachChromeExtensions.mock.calls.length);
          }),
        );

        const browserSession = yield* browserSessions.getSession("scope-a");

        assert.deepStrictEqual(attachCallsAtInitialization, [1]);
        assert.strictEqual(attachChromeExtensions.mock.calls[0]?.[0], browserSession);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "getSession should attach chrome extensions once when the same persistent partition is requested twice",
    () =>
      Effect.gen(function* () {
        const browserSessions = yield* BrowserSession.BrowserSession;

        yield* browserSessions.getSession("scope-a");
        yield* browserSessions.getSession("scope-a");

        assert.strictEqual(attachChromeExtensions.mock.calls.length, 1);
      }).pipe(Effect.provide(layer)),
  );

  it.effect("getSession should not attach chrome extensions when the session is ephemeral", () =>
    Effect.gen(function* () {
      const browserSessions = yield* BrowserSession.BrowserSession;

      yield* browserSessions.getSession("scope-a", false);

      assert.strictEqual(attachChromeExtensions.mock.calls.length, 0);
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "getSession should log a warning and still return the session when attaching chrome extensions throws",
    () => {
      const failure = new Error("toolbar unavailable");
      const warnings: Array<unknown> = [];
      const logger = Logger.make(({ logLevel, message }) => {
        if (logLevel === "Warn") warnings.push(message);
      });
      return Effect.gen(function* () {
        const browserSessions = yield* BrowserSession.BrowserSession;
        attachChromeExtensions.mockImplementation(() => {
          throw failure;
        });

        const partition = yield* browserSessions.getPartition("scope-a");
        const browserSession = yield* browserSessions.getSession("scope-a");

        assert.strictEqual<unknown>(browserSession, sessions.get(partition));
        assert.deepStrictEqual(yield* browserSessions.persistentSessions, [browserSession]);
        assert.deepStrictEqual(warnings, [
          ["Could not enable the browser extension toolbar.", failure],
        ]);
      }).pipe(
        Effect.provide(Layer.mergeAll(layer, Logger.layer([logger], { mergeWithExisting: false }))),
      );
    },
  );
});
