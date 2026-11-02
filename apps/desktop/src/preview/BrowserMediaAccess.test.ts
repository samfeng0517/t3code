import { assert, describe, it } from "@effect/vitest";
import type { BrowserMediaDecision, BrowserMediaDevice } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type { DesktopCapturerSource, Session, Streams, WebContents } from "electron";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vite-plus/test";

const { fromWebContents, getMediaAccessStatus, getSources, getAllDisplays, fromFrame } = vi.hoisted(
  () => ({
    fromWebContents: vi.fn<(webContents: unknown) => unknown>(() => null),
    getMediaAccessStatus: vi.fn<(mediaType: string) => string>(() => "granted"),
    getSources: vi.fn<(options: Electron.SourcesOptions) => Promise<Array<unknown>>>(),
    getAllDisplays: vi.fn<() => Array<{ id: number; label: string }>>(() => []),
    fromFrame: vi.fn<(frame: unknown) => unknown>(() => undefined),
  }),
);

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents },
  systemPreferences: { getMediaAccessStatus },
  desktopCapturer: { getSources },
  screen: { getAllDisplays },
  webContents: { fromFrame },
}));

import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as BrowserMediaAccess from "./BrowserMediaAccess.ts";
import * as BrowserMediaPermissions from "./BrowserMediaPermissions.ts";

const { showMessageBox } = vi.hoisted(() => ({
  showMessageBox: vi.fn<
    (
      options: Electron.MessageBoxOptions,
      owner?: Electron.BrowserWindow,
    ) => number | Promise<number>
  >(() => 2),
}));
const layerDialog = Layer.succeed(ElectronDialog.ElectronDialog, {
  pickFolder: () => Effect.die("unused"),
  pickFiles: () => Effect.die("unused"),
  showMessageBox: (options, owner) =>
    Effect.tryPromise({
      try: async () => ({ response: await showMessageBox(options, owner), checkboxChecked: false }),
      catch: (cause) =>
        new ElectronDialog.ElectronDialogShowMessageBoxError({
          type: options.type ?? null,
          titleLength: null,
          messageLength: options.message.length,
          detailLength: null,
          buttonCount: options.buttons?.length ?? 0,
          cause,
        }),
    }),
  showErrorBox: () => Effect.void,
});

const storedDecisions = new Map<string, BrowserMediaDecision>();
const storeKey = (origin: string, device: BrowserMediaDevice) => `${origin} ${device}`;
const storeSet = vi.fn<
  (origin: string, device: BrowserMediaDevice, decision: BrowserMediaDecision) => void
>((origin, device, decision) => void storedDecisions.set(storeKey(origin, device), decision));
const layerMediaPermissions = Layer.succeed(BrowserMediaPermissions.BrowserMediaPermissions, {
  decisionFor: (origin, device) => storedDecisions.get(storeKey(origin, device)),
  set: (origin, device, decision) => Effect.sync(() => storeSet(origin, device, decision)),
  remove: () => Effect.succeed([]),
  list: Effect.succeed([]),
});

const layer = BrowserMediaAccess.layer.pipe(
  Layer.provide(Layer.mergeAll(layerDialog, layerMediaPermissions)),
);

const MEET = "https://meet.google.com";

const makeRequester = (url: string) => {
  const state = { url, destroyed: false };
  const listeners = new Map<string, Array<() => void>>();
  const requester = {
    isDestroyed: () => state.destroyed,
    getURL: () => state.url,
    once: (event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return requester;
    },
  };
  const emit = (event: string) => {
    const pending = listeners.get(event) ?? [];
    listeners.delete(event);
    for (const listener of pending) listener();
  };
  return { webContents: requester as unknown as WebContents, state, emit };
};

type MediaDetails = Parameters<BrowserMediaAccess.BrowserMediaAccess["Service"]["requestMedia"]>[1];

const repeatedCallbacks = { count: 0 };
const requestWith =
  (access: BrowserMediaAccess.BrowserMediaAccess["Service"]) =>
  (requester: WebContents | null, details: MediaDetails, persistent = true): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      let called = false;
      access.requestMedia(requester, details, persistent, (granted) => {
        if (called) repeatedCallbacks.count += 1;
        called = true;
        resolve(granted);
      });
    });

const camAndMic = (requestingUrl: string) => ({
  requestingUrl,
  isMainFrame: true,
  mediaTypes: ["video", "audio"],
});

const pendingDialog = () => {
  const { promise, resolve } = Promise.withResolvers<number>();
  showMessageBox.mockImplementation(() => promise);
  return resolve;
};

const mainFrame = { parent: null };
const subFrame = { parent: mainFrame };

type DisplayRequest = Electron.DisplayMediaRequestHandlerHandlerRequest;
const displayRequest = (overrides: Partial<Record<keyof DisplayRequest, unknown>> = {}) =>
  ({
    frame: mainFrame,
    securityOrigin: `${MEET}/`,
    videoRequested: true,
    audioRequested: false,
    userGesture: true,
    ...overrides,
  }) as DisplayRequest;

const screenSource = (displayId: string, index: number) =>
  ({
    id: `screen:${index}:0`,
    name: `Entire screen ${index}`,
    display_id: displayId,
  }) as unknown as DesktopCapturerSource;

const installDisplayHandler = (access: BrowserMediaAccess.BrowserMediaAccess["Service"]) => {
  const setDisplayMediaRequestHandler = vi.fn<Session["setDisplayMediaRequestHandler"]>();
  access.installDisplayMediaHandler({ setDisplayMediaRequestHandler } as unknown as Session);
  const handler = setDisplayMediaRequestHandler.mock.calls[0]?.[0];
  assert.isDefined(handler);
  return (request: DisplayRequest): Promise<Streams | null> =>
    new Promise<Streams | null>((resolve) => {
      let called = false;
      handler?.(request, (streams) => {
        if (called) repeatedCallbacks.count += 1;
        called = true;
        resolve(streams);
      });
    });
};

describe("BrowserMediaAccess", () => {
  beforeEach(() => {
    getSources.mockReset();
    getSources.mockResolvedValue([]);
    getAllDisplays.mockReset();
    getAllDisplays.mockReturnValue([]);
    fromFrame.mockReset();
    fromWebContents.mockReset();
    fromWebContents.mockReturnValue(null);
    storedDecisions.clear();
    storeSet.mockClear();
    repeatedCallbacks.count = 0;
    showMessageBox.mockReset();
    showMessageBox.mockReturnValue(2);
    getMediaAccessStatus.mockReset();
    getMediaAccessStatus.mockReturnValue("granted");
  });

  it.effect(
    "requestMedia should deny without prompt when the requester is not an http(s) main frame",
    () =>
      Effect.gen(function* () {
        const request = requestWith(yield* BrowserMediaAccess.BrowserMediaAccess);
        const { webContents } = makeRequester(`${MEET}/abc`);
        showMessageBox.mockReturnValue(0);

        assert.isFalse(
          yield* Effect.promise(() => request(webContents, camAndMic("file:///tmp/a.html"))),
        );
        assert.isFalse(
          yield* Effect.promise(() =>
            request(webContents, { ...camAndMic(`${MEET}/abc`), isMainFrame: false }),
          ),
        );
        assert.isFalse(
          yield* Effect.promise(() =>
            request(webContents, {
              ...camAndMic(`${MEET}/abc`),
              securityOrigin: "https://ads.example.com/",
            }),
          ),
        );
        assert.isFalse(yield* Effect.promise(() => request(null, camAndMic(`${MEET}/abc`))));
        assert.strictEqual(showMessageBox.mock.calls.length, 0);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "requestMedia should grant without prompt when mediaTypes is empty on an http(s) main frame",
    () =>
      Effect.gen(function* () {
        const request = requestWith(yield* BrowserMediaAccess.BrowserMediaAccess);
        const { webContents } = makeRequester(`${MEET}/abc`);

        assert.isTrue(
          yield* Effect.promise(() =>
            request(webContents, {
              requestingUrl: `${MEET}/abc`,
              isMainFrame: true,
              mediaTypes: [],
            }),
          ),
        );
        assert.isTrue(
          yield* Effect.promise(() =>
            request(webContents, { requestingUrl: `${MEET}/abc`, isMainFrame: true }),
          ),
        );
        assert.isFalse(
          yield* Effect.promise(() =>
            request(webContents, {
              requestingUrl: `${MEET}/abc`,
              isMainFrame: false,
              mediaTypes: [],
            }),
          ),
        );
        assert.strictEqual(showMessageBox.mock.calls.length, 0);
        assert.strictEqual(storeSet.mock.calls.length, 0);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "requestMedia should grant without prompt when every requested device is remembered allow",
    () =>
      Effect.gen(function* () {
        const request = requestWith(yield* BrowserMediaAccess.BrowserMediaAccess);
        const { webContents } = makeRequester(`${MEET}/abc`);
        storedDecisions.set(storeKey(MEET, "camera"), "allow");
        storedDecisions.set(storeKey(MEET, "microphone"), "allow");

        assert.isTrue(yield* Effect.promise(() => request(webContents, camAndMic(`${MEET}/abc`))));
        assert.strictEqual(showMessageBox.mock.calls.length, 0);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "requestMedia should deny without prompt when any requested device is remembered block",
    () =>
      Effect.gen(function* () {
        const request = requestWith(yield* BrowserMediaAccess.BrowserMediaAccess);
        const { webContents } = makeRequester(`${MEET}/abc`);
        storedDecisions.set(storeKey(MEET, "camera"), "block");
        storedDecisions.set(storeKey(MEET, "microphone"), "allow");
        showMessageBox.mockReturnValue(0);

        assert.isFalse(yield* Effect.promise(() => request(webContents, camAndMic(`${MEET}/abc`))));
        assert.strictEqual(showMessageBox.mock.calls.length, 0);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "requestMedia should ask only for unknown devices when one device is already allowed",
    () =>
      Effect.gen(function* () {
        const request = requestWith(yield* BrowserMediaAccess.BrowserMediaAccess);
        const { webContents } = makeRequester(`${MEET}/abc`);
        storedDecisions.set(storeKey(MEET, "camera"), "allow");
        showMessageBox.mockReturnValue(0);

        assert.isTrue(yield* Effect.promise(() => request(webContents, camAndMic(`${MEET}/abc`))));
        assert.strictEqual(showMessageBox.mock.calls.length, 1);
        assert.strictEqual(
          showMessageBox.mock.calls[0]?.[0].message,
          "Allow meet.google.com to use your microphone?",
        );
        assert.deepStrictEqual(storeSet.mock.calls, [[MEET, "microphone", "allow"]]);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "requestMedia should default to Not now when it prompts for camera and microphone",
    () =>
      Effect.gen(function* () {
        const request = requestWith(yield* BrowserMediaAccess.BrowserMediaAccess);
        const { webContents } = makeRequester(`${MEET}/abc`);

        assert.isFalse(
          yield* Effect.promise(() =>
            request(webContents, {
              requestingUrl: `${MEET}/abc`,
              isMainFrame: true,
              mediaTypes: ["audio", "video", "audio"],
              securityOrigin: `${MEET}/`,
            }),
          ),
        );
        const options = showMessageBox.mock.calls[0]?.[0];
        assert.deepInclude(options, {
          type: "question",
          buttons: ["Allow", "Block", "Not now"],
          defaultId: 2,
          cancelId: 2,
          message: "Allow meet.google.com to use your camera and microphone?",
          detail: "You can change this later in Settings → Browser → Browsing.",
        });
        assert.strictEqual(storeSet.mock.calls.length, 0);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "requestMedia should remember incognito answers in memory only when the partition is not persistent",
    () =>
      Effect.gen(function* () {
        const request = requestWith(yield* BrowserMediaAccess.BrowserMediaAccess);
        const first = makeRequester(`${MEET}/abc`);
        const second = makeRequester(`${MEET}/other`);
        showMessageBox.mockReturnValue(0);

        assert.isTrue(
          yield* Effect.promise(() => request(first.webContents, camAndMic(`${MEET}/abc`), false)),
        );
        assert.strictEqual(
          showMessageBox.mock.calls[0]?.[0].detail,
          "This choice is forgotten when T3 Code quits.",
        );
        assert.strictEqual(storeSet.mock.calls.length, 0);

        assert.isTrue(
          yield* Effect.promise(() =>
            request(second.webContents, camAndMic(`${MEET}/other`), false),
          ),
        );
        assert.strictEqual(showMessageBox.mock.calls.length, 1);

        assert.isTrue(
          yield* Effect.promise(() => request(first.webContents, camAndMic(`${MEET}/abc`), true)),
        );
        assert.strictEqual(showMessageBox.mock.calls.length, 2);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "requestMedia should ask again after the page navigates when the user chose Not now",
    () =>
      Effect.gen(function* () {
        const request = requestWith(yield* BrowserMediaAccess.BrowserMediaAccess);
        const { webContents, emit } = makeRequester(`${MEET}/abc`);

        showMessageBox.mockReturnValueOnce(2);
        assert.isFalse(yield* Effect.promise(() => request(webContents, camAndMic(`${MEET}/abc`))));
        assert.isFalse(yield* Effect.promise(() => request(webContents, camAndMic(`${MEET}/abc`))));
        assert.strictEqual(showMessageBox.mock.calls.length, 1);

        emit("did-navigate");
        showMessageBox.mockRejectedValueOnce(new Error("dialog failed"));
        assert.isFalse(yield* Effect.promise(() => request(webContents, camAndMic(`${MEET}/abc`))));
        assert.strictEqual(showMessageBox.mock.calls.length, 2);
        assert.isFalse(yield* Effect.promise(() => request(webContents, camAndMic(`${MEET}/abc`))));
        assert.strictEqual(showMessageBox.mock.calls.length, 2);

        emit("did-navigate");
        showMessageBox.mockReturnValueOnce(0);
        assert.isTrue(yield* Effect.promise(() => request(webContents, camAndMic(`${MEET}/abc`))));
        assert.strictEqual(showMessageBox.mock.calls.length, 3);
        assert.strictEqual(storeSet.mock.calls.length, 2);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "requestMedia should share the answer with the same origin and deny another origin when a prompt is open",
    () =>
      Effect.gen(function* () {
        const request = requestWith(yield* BrowserMediaAccess.BrowserMediaAccess);
        const first = makeRequester(`${MEET}/abc`);
        const sameSite = makeRequester(`${MEET}/xyz`);
        const other = makeRequester("https://chat.example.com/");
        const release = pendingDialog();

        const firstAnswer = request(first.webContents, camAndMic(`${MEET}/abc`));
        const sameSiteAnswer = request(sameSite.webContents, {
          requestingUrl: `${MEET}/xyz`,
          isMainFrame: true,
          mediaTypes: ["audio"],
        });
        const otherAnswer = request(other.webContents, camAndMic("https://chat.example.com/"));
        assert.isFalse(yield* Effect.promise(() => otherAnswer));
        assert.strictEqual(showMessageBox.mock.calls.length, 1);

        release(0);
        assert.isTrue(yield* Effect.promise(() => firstAnswer));
        assert.isTrue(yield* Effect.promise(() => sameSiteAnswer));
        assert.strictEqual(repeatedCallbacks.count, 0);
        assert.strictEqual(showMessageBox.mock.calls.length, 1);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "requestMedia should deny but still save the answer when the requester left the origin before the dialog settled",
    () =>
      Effect.gen(function* () {
        const request = requestWith(yield* BrowserMediaAccess.BrowserMediaAccess);
        const moved = makeRequester(`${MEET}/abc`);
        const closed = makeRequester(`${MEET}/xyz`);
        const release = pendingDialog();

        const movedAnswer = request(moved.webContents, camAndMic(`${MEET}/abc`));
        const closedAnswer = request(closed.webContents, camAndMic(`${MEET}/xyz`));
        moved.state.url = "https://chat.example.com/";
        closed.state.destroyed = true;
        release(0);

        assert.isFalse(yield* Effect.promise(() => movedAnswer));
        assert.isFalse(yield* Effect.promise(() => closedAnswer));
        assert.strictEqual(storedDecisions.get(storeKey(MEET, "camera")), "allow");
        assert.strictEqual(storedDecisions.get(storeKey(MEET, "microphone")), "allow");
        assert.strictEqual(repeatedCallbacks.count, 0);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "requestMedia should show both macOS hints camera first when camera and microphone are denied",
    () =>
      Effect.gen(function* () {
        const request = requestWith(yield* BrowserMediaAccess.BrowserMediaAccess);
        const { webContents } = makeRequester(`${MEET}/abc`);
        getMediaAccessStatus.mockReturnValue("denied");

        assert.isFalse(yield* Effect.promise(() => request(webContents, camAndMic(`${MEET}/abc`))));
        assert.strictEqual(
          showMessageBox.mock.calls[0]?.[0].detail,
          "macOS is blocking T3 Code from using the camera. Turn it on in System Settings → Privacy & Security → Camera.\n\nmacOS is blocking T3 Code from using the microphone. Turn it on in System Settings → Privacy & Security → Microphone.",
        );
      }).pipe(Effect.provide(layer), Effect.provideService(HostProcess.Platform, "darwin")),
  );

  it.effect(
    "checkMedia should allow only remembered devices for main frames when the source matches the partition",
    () =>
      Effect.gen(function* () {
        const access = yield* BrowserMediaAccess.BrowserMediaAccess;
        const request = requestWith(access);
        storedDecisions.set(storeKey(MEET, "camera"), "allow");
        storedDecisions.set(storeKey(MEET, "microphone"), "block");
        const chat = "https://chat.example.com";
        showMessageBox.mockReturnValue(0);
        assert.isTrue(
          yield* Effect.promise(() =>
            request(makeRequester(`${chat}/`).webContents, camAndMic(`${chat}/`), false),
          ),
        );

        const mainFrame = { isMainFrame: true, mediaType: "video" };
        assert.isTrue(access.checkMedia(MEET, mainFrame, true));
        assert.isFalse(access.checkMedia(MEET, { ...mainFrame, mediaType: "audio" }, true));
        assert.isFalse(access.checkMedia(MEET, { ...mainFrame, mediaType: "unknown" }, true));
        assert.isFalse(access.checkMedia(MEET, { isMainFrame: true }, true));
        assert.isFalse(access.checkMedia(MEET, { ...mainFrame, isMainFrame: false }, true));
        assert.isFalse(access.checkMedia(MEET, { ...mainFrame, embeddingOrigin: chat }, true));
        assert.isFalse(access.checkMedia("file:///tmp/a.html", mainFrame, true));
        assert.isFalse(access.checkMedia(MEET, mainFrame, false));
        assert.isTrue(access.checkMedia(chat, { ...mainFrame, mediaType: "audio" }, false));
        assert.isFalse(access.checkMedia(chat, mainFrame, true));
      }).pipe(Effect.provide(layer)),
  );
  it.effect("allowDisplayCapture should allow only http(s) main frames", () =>
    Effect.gen(function* () {
      const access = yield* BrowserMediaAccess.BrowserMediaAccess;

      assert.isTrue(
        access.allowDisplayCapture({ requestingUrl: `${MEET}/abc`, isMainFrame: true }),
      );
      assert.isTrue(
        access.allowDisplayCapture({ requestingUrl: "http://localhost:3000/", isMainFrame: true }),
      );
      assert.isFalse(
        access.allowDisplayCapture({ requestingUrl: `${MEET}/abc`, isMainFrame: false }),
      );
      assert.isFalse(access.allowDisplayCapture({ requestingUrl: `${MEET}/abc` }));
      assert.isFalse(
        access.allowDisplayCapture({ requestingUrl: "file:///tmp/a.html", isMainFrame: true }),
      );
      assert.isFalse(access.allowDisplayCapture({ isMainFrame: true }));
    }).pipe(Effect.provide(layer)),
  );

  it.effect("installDisplayMediaHandler should request the system picker once per session", () =>
    Effect.gen(function* () {
      const access = yield* BrowserMediaAccess.BrowserMediaAccess;
      const setDisplayMediaRequestHandler = vi.fn<Session["setDisplayMediaRequestHandler"]>();
      const browserSession = { setDisplayMediaRequestHandler } as unknown as Session;

      access.installDisplayMediaHandler(browserSession);
      access.installDisplayMediaHandler(browserSession);

      assert.strictEqual(setDisplayMediaRequestHandler.mock.calls.length, 1);
      assert.deepStrictEqual(setDisplayMediaRequestHandler.mock.calls[0]?.[1], {
        useSystemPicker: true,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "display handler should reject without dialog when the request lacks a user gesture or comes from a subframe",
    () =>
      Effect.gen(function* () {
        const share = installDisplayHandler(yield* BrowserMediaAccess.BrowserMediaAccess);
        getSources.mockResolvedValue([screenSource("1", 1)]);
        showMessageBox.mockReturnValue(0);

        for (const overrides of [
          { userGesture: false },
          { frame: subFrame },
          { frame: null },
          { securityOrigin: "file:///tmp/a.html" },
        ]) {
          assert.deepStrictEqual(yield* Effect.promise(() => share(displayRequest(overrides))), {});
        }
        assert.strictEqual(getSources.mock.calls.length, 0);
        assert.strictEqual(showMessageBox.mock.calls.length, 0);

        const release = pendingDialog();
        const firstAnswer = share(displayRequest());
        assert.deepStrictEqual(yield* Effect.promise(() => share(displayRequest())), {});
        release(1);
        assert.deepStrictEqual(yield* Effect.promise(() => firstAnswer), {});
        assert.strictEqual(getSources.mock.calls.length, 1);
        assert.strictEqual(showMessageBox.mock.calls.length, 1);
        assert.strictEqual(repeatedCallbacks.count, 0);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "display handler should label screens by display name and fall back to Screen N when a name is missing",
    () =>
      Effect.gen(function* () {
        const share = installDisplayHandler(yield* BrowserMediaAccess.BrowserMediaAccess);
        const guest = { isDestroyed: () => false, hostWebContents: { isDestroyed: () => false } };
        const owner = { id: 7 };
        fromFrame.mockImplementation((frame) => (frame === mainFrame ? guest : undefined));
        fromWebContents.mockImplementation((contents) =>
          contents === guest.hostWebContents ? owner : null,
        );
        getAllDisplays.mockReturnValue([
          { id: 1, label: "Built-in Retina Display" },
          { id: 2, label: "" },
          { id: 3, label: "DELL U2720Q" },
        ]);
        getSources.mockResolvedValue([
          screenSource("1", 1),
          screenSource("", 2),
          screenSource("2", 3),
          screenSource("9", 4),
          screenSource("3", 5),
        ]);
        showMessageBox.mockReturnValue(5);

        assert.deepStrictEqual(yield* Effect.promise(() => share(displayRequest())), {});
        assert.deepStrictEqual(getSources.mock.calls[0]?.[0], {
          types: ["screen"],
          thumbnailSize: { width: 0, height: 0 },
        });
        assert.deepInclude(showMessageBox.mock.calls[0]?.[0], {
          type: "question",
          buttons: [
            "Built-in Retina Display",
            "Screen 2",
            "Screen 3",
            "Screen 4",
            "DELL U2720Q",
            "Cancel",
          ],
          defaultId: 5,
          cancelId: 5,
          message: "Share your screen with meet.google.com?",
          detail: "meet.google.com will see everything on the screen you choose.",
        });
        assert.strictEqual(showMessageBox.mock.calls[0]?.[1], owner);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "display handler should share the chosen screen without audio when the user picks it",
    () =>
      Effect.gen(function* () {
        const share = installDisplayHandler(yield* BrowserMediaAccess.BrowserMediaAccess);
        const source = screenSource("1", 1);
        getSources.mockResolvedValue([source]);

        showMessageBox.mockReturnValueOnce(0);
        const shared = yield* Effect.promise(() => share(displayRequest()));
        assert.deepStrictEqual(shared, { video: source });
        assert.strictEqual(shared?.video, source);
        assert.deepStrictEqual(showMessageBox.mock.calls[0]?.[0].buttons, ["Screen 1", "Cancel"]);

        showMessageBox.mockReturnValueOnce(1);
        assert.deepStrictEqual(yield* Effect.promise(() => share(displayRequest())), {});

        showMessageBox.mockRejectedValueOnce(new Error("dialog failed"));
        assert.deepStrictEqual(yield* Effect.promise(() => share(displayRequest())), {});
        assert.strictEqual(showMessageBox.mock.calls.length, 3);
        assert.strictEqual(repeatedCallbacks.count, 0);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "display handler should show a Cancel-only hint when no screens are returned and macOS denies screen recording",
    () =>
      Effect.gen(function* () {
        const share = installDisplayHandler(yield* BrowserMediaAccess.BrowserMediaAccess);
        const hint =
          "macOS is blocking T3 Code from recording the screen. Allow it in System Settings → Privacy & Security, then try again.";
        getMediaAccessStatus.mockImplementation((mediaType) =>
          mediaType === "screen" ? "denied" : "granted",
        );

        assert.deepStrictEqual(yield* Effect.promise(() => share(displayRequest())), {});
        assert.deepInclude(showMessageBox.mock.calls[0]?.[0], {
          buttons: ["Cancel"],
          defaultId: 0,
          cancelId: 0,
          message: "Share your screen with meet.google.com?",
          detail: hint,
        });

        getSources.mockResolvedValueOnce([screenSource("1", 1)]);
        assert.deepStrictEqual(yield* Effect.promise(() => share(displayRequest())), {});
        assert.strictEqual(showMessageBox.mock.calls[1]?.[0].detail, hint);

        getMediaAccessStatus.mockReturnValue("granted");
        assert.deepStrictEqual(yield* Effect.promise(() => share(displayRequest())), {});
        getSources.mockRejectedValueOnce(new Error("capturer failed"));
        assert.deepStrictEqual(yield* Effect.promise(() => share(displayRequest())), {});
        assert.strictEqual(showMessageBox.mock.calls.length, 2);
        assert.strictEqual(repeatedCallbacks.count, 0);
      }).pipe(Effect.provide(layer), Effect.provideService(HostProcess.Platform, "darwin")),
  );
});
