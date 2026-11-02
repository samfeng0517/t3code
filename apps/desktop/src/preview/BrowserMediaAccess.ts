import type { BrowserMediaDecision, BrowserMediaDevice } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type { WebContents } from "electron";
import { systemPreferences } from "electron";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
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

interface MediaCheckDetails {
  readonly isMainFrame?: boolean;
  readonly embeddingOrigin?: string;
  readonly mediaType?: string;
}

/** @public */
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
  }
>()("@t3tools/desktop/preview/BrowserMediaAccess") {}

const httpOrigin = (rawUrl: string | undefined): string | null => {
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

interface PendingRequest {
  readonly requester: WebContents;
  readonly devices: ReadonlyArray<BrowserMediaDevice>;
  readonly persistent: boolean;
  readonly callback: (granted: boolean) => void;
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

  // One media prompt at a time across sites; the same site's later requests share its answer.
  let openPrompt: { readonly origin: string; readonly requests: Array<PendingRequest> } | null =
    null;

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
    // Screen share under the macOS system picker arrives with no devices; the picker is the consent.
    if (devices.length === 0) {
      callback(true);
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
    const request: PendingRequest = { requester, devices, persistent, callback };
    if (openPrompt !== null) {
      if (openPrompt.origin === origin) openPrompt.requests.push(request);
      else callback(false);
      return;
    }
    const prompt = { origin, requests: [request] };
    openPrompt = prompt;
    const unknownDevices = devices.filter((_, index) => remembered[index] === undefined);

    const grantedAfterPrompt = (pending: PendingRequest): boolean =>
      !pending.requester.isDestroyed() &&
      httpOrigin(pending.requester.getURL()) === origin &&
      pending.devices.every(
        (device) => rememberedDecision(origin, device, pending.persistent) === "allow",
      );
    const settle = (answered: boolean) =>
      Effect.sync(() => {
        if (openPrompt !== prompt) return;
        openPrompt = null;
        const results = prompt.requests.map((pending) => {
          if (!answered) defer(pending.requester, origin);
          return [pending.callback, answered && grantedAfterPrompt(pending)] as const;
        });
        for (const [resolve, granted] of results) resolve(granted);
      });

    runFork(
      electronDialog
        .showMessageBox(
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
        )
        .pipe(
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
          Effect.flatMap((decision) => settle(decision !== null)),
          Effect.onInterrupt(() => settle(false)),
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
      details.embeddingOrigin === undefined &&
      origin !== null &&
      device !== null &&
      rememberedDecision(origin, device, persistent) === "allow"
    );
  };

  return BrowserMediaAccess.of({ requestMedia, checkMedia });
}).pipe(Effect.withSpan("BrowserMediaAccess.make"));

/** @public */
export const layer = Layer.effect(BrowserMediaAccess, make);
