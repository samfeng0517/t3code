import type { BrowserMediaDecision, BrowserMediaDevice } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type {
  DesktopCapturerSource,
  DisplayMediaRequestHandlerHandlerRequest,
  Session,
  Streams,
  WebContents,
} from "electron";
import { desktopCapturer, screen, systemPreferences, webContents } from "electron";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import * as ElectronDialog from "../electron/ElectronDialog.ts";
import { BrowserMediaPermissions } from "./BrowserMediaPermissions.ts";
import { previewHostWindow } from "./PreviewHostWindow.ts";

interface MediaRequestDetails {
  readonly requestingUrl?: string;
  readonly isMainFrame?: boolean;
  readonly mediaTypes?: ReadonlyArray<string>;
  readonly securityOrigin?: string;
}

interface DisplayCaptureDetails {
  readonly requestingUrl?: string;
  readonly isMainFrame?: boolean;
}

interface MediaCheckDetails {
  readonly isMainFrame?: boolean;
  readonly embeddingOrigin?: string;
  readonly mediaType?: string;
}

export class BrowserMediaAccess extends Context.Service<
  BrowserMediaAccess,
  {
    readonly requestMedia: (
      requester: WebContents | null,
      details: MediaRequestDetails,
      persistent: boolean,
      callback: (granted: boolean) => void,
    ) => void;
    /** Synchronous because Electron's permission check handler cannot wait. */
    readonly checkMedia: (
      requestingOrigin: string,
      details: MediaCheckDetails,
      persistent: boolean,
    ) => boolean;
    readonly allowDisplayCapture: (details: DisplayCaptureDetails) => boolean;
    readonly installDisplayMediaHandler: (browserSession: Session) => void;
  }
>()("@t3tools/desktop/preview/BrowserMediaAccess") {}

/** The http(s) origin a site permission is remembered under, or null for any other page. */
export const httpOrigin = (rawUrl: string | undefined): string | null => {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

const urlOrigin = (rawUrl: string): string | null => {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
};

const deviceFor = (mediaType: string | undefined): BrowserMediaDevice | null =>
  mediaType === "video" ? "camera" : mediaType === "audio" ? "microphone" : null;

const requestedDevices = (
  mediaTypes: ReadonlyArray<string> | undefined,
): ReadonlyArray<BrowserMediaDevice> => {
  const devices = new Set((mediaTypes ?? []).map(deviceFor));
  return (["camera", "microphone"] as const).filter((device) => devices.has(device));
};

const promptMessage = (host: string, devices: ReadonlyArray<BrowserMediaDevice>): string =>
  devices.length > 1
    ? `Allow ${host} to use your camera and microphone?`
    : `Allow ${host} to use your ${devices[0]}?`;

const MAC_DEVICE_HINTS: Record<BrowserMediaDevice, string> = {
  camera:
    "macOS is blocking T3 Code from using the camera. Turn it on in System Settings → Privacy & Security → Camera.",
  microphone:
    "macOS is blocking T3 Code from using the microphone. Turn it on in System Settings → Privacy & Security → Microphone.",
};

const MAC_SCREEN_HINT =
  "macOS is blocking T3 Code from recording the screen. Allow it in System Settings → Privacy & Security, then try again.";

const screenLabels = (sources: ReadonlyArray<DesktopCapturerSource>): Array<string> => {
  const displays = screen.getAllDisplays();
  return sources.map((source, index) => {
    const label =
      source.display_id === ""
        ? undefined
        : displays.find((display) => String(display.id) === source.display_id)?.label;
    return label ? label : `Screen ${index + 1}`;
  });
};

interface PendingRequest {
  readonly requester: WebContents;
  readonly devices: ReadonlyArray<BrowserMediaDevice>;
  readonly callback: (granted: boolean) => void;
}

interface MediaPrompt {
  readonly origin: string;
  readonly persistent: boolean;
  readonly screen: boolean;
  readonly requests: Array<PendingRequest>;
}

/** @public */
export const make = Effect.gen(function* BrowserMediaAccessMake() {
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const mediaPermissions = yield* BrowserMediaPermissions;
  const platform = yield* HostProcess.Platform;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());

  // Shared by every incognito partition and never written to the store, so it ends with the process.
  const incognitoDecisions = new Map<string, BrowserMediaDecision>();
  const incognitoKey = (origin: string, device: BrowserMediaDevice) =>
    JSON.stringify([origin, device]);
  const rememberedDecision = (
    origin: string,
    device: BrowserMediaDevice,
    persistent: boolean,
  ): BrowserMediaDecision | undefined =>
    persistent
      ? mediaPermissions.decisionFor(origin, device)
      : incognitoDecisions.get(incognitoKey(origin, device));
  const remember = (
    origin: string,
    device: BrowserMediaDevice,
    persistent: boolean,
    decision: BrowserMediaDecision,
  ): Effect.Effect<void> =>
    persistent
      ? mediaPermissions.set(origin, device, decision)
      : Effect.sync(() => void incognitoDecisions.set(incognitoKey(origin, device), decision));

  // "Not now" lasts until the requester's next main-frame navigation or reload.
  const deferredOrigins = new WeakMap<WebContents, Set<string>>();
  const defer = (requester: WebContents, origin: string): void => {
    let origins = deferredOrigins.get(requester);
    if (origins === undefined) {
      origins = new Set();
      deferredOrigins.set(requester, origins);
      requester.once("did-navigate", () => deferredOrigins.delete(requester));
    }
    origins.add(origin);
  };

  // One media prompt at a time across sites; later requests of the same kind from the same site
  // and source share its answer.
  let openPrompt: MediaPrompt | null = null;

  /** The new prompt, or null when the request joined or was denied by the one already open. */
  const claimPrompt = (
    origin: string,
    persistent: boolean,
    screen: boolean,
    request: PendingRequest,
  ): MediaPrompt | null => {
    if (openPrompt !== null) {
      if (
        openPrompt.origin === origin &&
        openPrompt.persistent === persistent &&
        openPrompt.screen === screen
      ) {
        openPrompt.requests.push(request);
      } else {
        request.callback(false);
      }
      return null;
    }
    openPrompt = { origin, persistent, screen, requests: [request] };
    return openPrompt;
  };

  const settle = (prompt: MediaPrompt, granted: (pending: PendingRequest) => boolean) =>
    Effect.sync(() => {
      if (openPrompt !== prompt) return;
      openPrompt = null;
      const results = prompt.requests.map(
        (pending) => [pending.callback, granted(pending)] as const,
      );
      for (const [resolve, isGranted] of results) resolve(isGranted);
    });

  const stillOnOrigin = (pending: PendingRequest, origin: string): boolean =>
    !pending.requester.isDestroyed() && httpOrigin(pending.requester.getURL()) === origin;

  const screenRecordingDenied = (): boolean =>
    platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") === "denied";

  // Legacy getUserMedia desktop capture arrives with the same empty mediaTypes as a picker share
  // and records the whole screen with no picker, so every screen share needs T3's own consent.
  const requestScreenShare = (
    requester: WebContents,
    origin: string,
    persistent: boolean,
    callback: (granted: boolean) => void,
  ): void => {
    const prompt = claimPrompt(origin, persistent, true, { requester, devices: [], callback });
    if (prompt === null) return;
    runFork(
      Effect.suspend(() =>
        electronDialog.showMessageBox(
          {
            type: "question",
            buttons: ["Allow", "Cancel"],
            // Default to Cancel so an Enter typed into the page cannot start a share.
            defaultId: 1,
            cancelId: 1,
            message: `Allow ${new URL(origin).host} to share your screen?`,
            ...(screenRecordingDenied() ? { detail: MAC_SCREEN_HINT } : {}),
          },
          previewHostWindow(requester),
        ),
      ).pipe(
        Effect.map(({ response }) => response === 0),
        Effect.orElseSucceed(() => false),
        Effect.flatMap((allowed) =>
          settle(prompt, (pending) => allowed && stillOnOrigin(pending, origin)),
        ),
        Effect.ensuring(settle(prompt, () => false)),
      ),
    );
  };

  const promptDetail = (devices: ReadonlyArray<BrowserMediaDevice>, persistent: boolean) => {
    const macHints =
      platform === "darwin"
        ? devices
            .filter((device) => systemPreferences.getMediaAccessStatus(device) === "denied")
            .map((device) => MAC_DEVICE_HINTS[device])
        : [];
    if (macHints.length > 0) return macHints.join("\n\n");
    return persistent
      ? "You can change this later in Settings → Browser → Browsing."
      : "This choice is forgotten when T3 Code quits.";
  };

  const requestMedia = (
    requester: WebContents | null,
    details: MediaRequestDetails,
    persistent: boolean,
    callback: (granted: boolean) => void,
  ): void => {
    const origin = httpOrigin(details.requestingUrl);
    if (
      origin === null ||
      (details.securityOrigin !== undefined && urlOrigin(details.securityOrigin) !== origin) ||
      details.isMainFrame === false ||
      requester === null
    ) {
      callback(false);
      return;
    }
    const devices = requestedDevices(details.mediaTypes);
    if (devices.length === 0) {
      requestScreenShare(requester, origin, persistent, callback);
      return;
    }
    const remembered = devices.map((device) => rememberedDecision(origin, device, persistent));
    if (remembered.includes("block")) {
      callback(false);
      return;
    }
    if (remembered.every((decision) => decision === "allow")) {
      callback(true);
      return;
    }
    if (deferredOrigins.get(requester)?.has(origin) === true) {
      callback(false);
      return;
    }
    const prompt = claimPrompt(origin, persistent, false, { requester, devices, callback });
    if (prompt === null) return;
    const unknownDevices = devices.filter((_, index) => remembered[index] === undefined);

    const settleDevices = (answered: boolean) =>
      settle(prompt, (pending) => {
        if (!answered) {
          defer(pending.requester, origin);
          return false;
        }
        return (
          stillOnOrigin(pending, origin) &&
          pending.devices.every(
            (device) => rememberedDecision(origin, device, persistent) === "allow",
          )
        );
      });

    // Options are built inside the fiber so a throw there still frees the slot via `ensuring`.
    runFork(
      Effect.suspend(() =>
        electronDialog.showMessageBox(
          {
            type: "question",
            buttons: ["Allow", "Block", "Not now"],
            // Default to Not now so an Enter typed into the page cannot grant a device.
            defaultId: 2,
            cancelId: 2,
            message: promptMessage(new URL(origin).host, unknownDevices),
            detail: promptDetail(unknownDevices, persistent),
          },
          previewHostWindow(requester),
        ),
      ).pipe(
        Effect.map(({ response }): BrowserMediaDecision | null =>
          response === 0 ? "allow" : response === 1 ? "block" : null,
        ),
        Effect.orElseSucceed(() => null),
        Effect.tap((decision) =>
          decision === null
            ? Effect.void
            : Effect.forEach(
                unknownDevices,
                (device) => remember(origin, device, persistent, decision),
                { discard: true },
              ),
        ),
        Effect.flatMap((decision) => settleDevices(decision !== null)),
        Effect.ensuring(settleDevices(false)),
      ),
    );
  };

  const checkMedia = (
    requestingOrigin: string,
    details: MediaCheckDetails,
    persistent: boolean,
  ): boolean => {
    const origin = httpOrigin(requestingOrigin);
    const device = deviceFor(details.mediaType);
    return (
      details.isMainFrame === true &&
      origin !== null &&
      // Electron sends the main frame's own origin as embeddingOrigin for main-frame checks.
      (details.embeddingOrigin === undefined || httpOrigin(details.embeddingOrigin) === origin) &&
      device !== null &&
      rememberedDecision(origin, device, persistent) === "allow"
    );
  };

  const allowDisplayCapture = (details: DisplayCaptureDetails): boolean =>
    details.isMainFrame === true && httpOrigin(details.requestingUrl) !== null;

  // One fallback screen dialog at a time across every session.
  let screenDialogOpen = false;

  const handleDisplayMedia = (
    request: DisplayMediaRequestHandlerHandlerRequest,
    callback: (streams: Streams) => void,
  ): void => {
    const frame = request.frame;
    const origin = httpOrigin(request.securityOrigin);
    if (
      request.userGesture !== true ||
      frame === null ||
      frame.parent !== null ||
      origin === null ||
      screenDialogOpen
    ) {
      callback({});
      return;
    }
    screenDialogOpen = true;
    const host = new URL(origin).host;

    const chooseScreen = Effect.tryPromise(() =>
      desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } }),
    ).pipe(
      Effect.flatMap((sources): Effect.Effect<Streams, unknown> => {
        const screenDenied = screenRecordingDenied();
        if (sources.length === 0 && !screenDenied) return Effect.succeed({});
        const buttons = [...screenLabels(sources), "Cancel"];
        return electronDialog
          .showMessageBox(
            {
              type: "question",
              buttons,
              // Default to Cancel so an Enter typed into the page cannot start a share.
              defaultId: sources.length,
              cancelId: sources.length,
              message: `Share your screen with ${host}?`,
              detail: screenDenied
                ? MAC_SCREEN_HINT
                : `${host} will see everything on the screen you choose.`,
            },
            previewHostWindow(webContents.fromFrame(frame) ?? null),
          )
          .pipe(
            Effect.map(({ response }): Streams => {
              const source = sources[response];
              return source === undefined ? {} : { video: source };
            }),
          );
      }),
      Effect.orElseSucceed((): Streams => ({})),
    );

    runFork(
      chooseScreen.pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            screenDialogOpen = false;
            callback(Exit.isSuccess(exit) ? exit.value : {});
          }),
        ),
      ),
    );
  };

  const displayMediaSessions = new WeakSet<Session>();
  const installDisplayMediaHandler = (browserSession: Session): void => {
    if (displayMediaSessions.has(browserSession)) return;
    displayMediaSessions.add(browserSession);
    // Electron skips the handler when the system picker is available, so it only runs as the fallback.
    browserSession.setDisplayMediaRequestHandler(handleDisplayMedia, { useSystemPicker: true });
  };

  return BrowserMediaAccess.of({
    requestMedia,
    checkMedia,
    allowDisplayCapture,
    installDisplayMediaHandler,
  });
}).pipe(Effect.withSpan("BrowserMediaAccess.make"));

export const layer = Layer.effect(BrowserMediaAccess, make);
