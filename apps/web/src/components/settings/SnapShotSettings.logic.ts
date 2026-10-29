import type { ClientSettingsPatch, DesktopSnapShotState, SnapShotSound } from "@t3tools/contracts";
import { t as globalT, type Translate } from "~/i18n";
import {
  captureSetupBackend,
  captureSetupDesktopName,
  captureSetupAccessReady,
  captureSetupMacPermissionsReady,
} from "./SnapShotSetupDialog.logic";

export function snapShotStatus(
  state: DesktopSnapShotState | null,
  enabled: boolean,
  t: Translate = globalT,
): string {
  if (!state) return t("settingsMisc.snapShot.checking");
  if (state.mode === "unavailable") {
    return state.message ?? t("settingsMisc.snapShot.unsupportedPlatform");
  }
  if (!enabled) return t("settingsMisc.snapShot.turnOnToSetUp");
  return snapShotSetupSummary(state, enabled, t);
}

export function snapShotSetupSummary(
  state: DesktopSnapShotState,
  enabled: boolean,
  t: Translate = globalT,
): string {
  if (state.message) return t("settingsMisc.snapShot.needsAttention");
  if (state.linuxBackend === "hyprland" && state.hyprlandHelper?.status !== "ready")
    return state.hyprlandHelper?.status === "error"
      ? t("settingsMisc.snapShot.checkAccess")
      : t("settingsMisc.snapShot.installHelper");
  if (captureSetupBackend(state) === "gnome" && state.gnomeExtension?.status !== "enabled")
    return t("settingsMisc.snapShot.setUpActiveWindow");
  if (captureSetupBackend(state) === "kde" && state.kdeHelper?.status !== "ready")
    return state.kdeHelper?.status === "error"
      ? t("settingsMisc.snapShot.checkAccess")
      : t("settingsMisc.snapShot.installHelper");
  if (captureSetupBackend(state) === "picker") return t("settingsMisc.snapShot.manualOnly");
  if (!enabled) return t("settingsMisc.snapShot.enableToContinue");
  if (state.shortcutPending)
    return state.linuxBackend === "hyprland"
      ? t("settingsMisc.snapShot.connectingShortcut")
      : t("settingsMisc.snapShot.waitingPermission");
  if (state.shortcutVerified) return t("settingsMisc.snapShot.ready");
  if (state.linuxBackend === "niri" && state.shortcutBinding)
    return t("settingsMisc.snapShot.useFromOtherApp");
  if (state.linuxBackend === "hyprland" && state.shortcutActionRegistered)
    return t("settingsMisc.snapShot.useFromOtherApp");
  if (state.shortcutRegistered) {
    return state.shortcutLabel
      ? t("settingsMisc.snapShot.ready")
      : t("settingsMisc.snapShot.shortcutSavedShort");
  }
  return t("settingsMisc.snapShot.finishShortcut");
}

export function snapShotShortcutStatus(
  state: DesktopSnapShotState | null,
  t: Translate = globalT,
): string | null {
  if (!state) return null;
  if (state.linuxBackend === "hyprland") return state.shortcutMessage;
  if (state.shortcutPending) return t("settingsMisc.snapShot.approvePrompt");
  if (state.shortcutRegistered) {
    return state.mode === "portal" ? null : t("settingsMisc.snapShot.shortcutSaved");
  }
  return state.shortcutMessage;
}

export function snapShotSetupButtonLabel(
  state: DesktopSnapShotState | null,
  t: Translate = globalT,
): string {
  if (!state) return t("settingsMisc.snapShot.continueSetup");
  if (captureSetupAccessReady(state)) return t("settingsMisc.snapShot.manageCapture");
  const desktop = captureSetupDesktopName(state);
  return desktop
    ? t("settingsMisc.snapShot.setUpDesktop", { desktop })
    : t("settingsMisc.snapShot.continueSetup");
}

export function snapShotSetupComplete(
  state: DesktopSnapShotState | null,
  includeAccessibility: boolean,
): boolean {
  if (state?.windows) return true;
  return (
    state?.macPermissions !== undefined &&
    captureSetupAccessReady(state) &&
    captureSetupMacPermissionsReady(state, includeAccessibility) &&
    state.shortcutRegistered
  );
}

export type SnapShotSoundSelection = SnapShotSound | "off";

export function snapShotFeedbackUnavailableMessage(
  state: DesktopSnapShotState | null,
  t: Translate = globalT,
): string | undefined {
  if (state?.mode !== "portal" || state.linuxFeedbackAvailable) return undefined;
  if (state.linuxBackend === "hyprland")
    return state.hyprlandHelper?.status === "ready"
      ? t("settingsMisc.snapShot.effectsUnavailableDesktop")
      : t("settingsMisc.snapShot.installOrUpdateHelper");
  if (state.linuxBackend === "niri") return t("settingsMisc.snapShot.effectsUnavailableNiri");
  if (state.linuxBackend === "kde")
    return state.kdeHelper?.status === "ready"
      ? t("settingsMisc.snapShot.effectsUnavailableDesktop")
      : t("settingsMisc.snapShot.installOrUpdateHelper");
  return state.linuxBackend === "gnome-extension"
    ? t("settingsMisc.snapShot.updateGnomeExtension")
    : captureSetupBackend(state) === "gnome"
      ? t("settingsMisc.snapShot.finishExtension")
      : t("settingsMisc.snapShot.effectsUnavailableDesktop");
}

export function snapShotDescription(
  state: DesktopSnapShotState | null,
  t: Translate = globalT,
): string {
  return state?.mode === "portal" && captureSetupBackend(state) === "picker"
    ? t("settingsMisc.snapShot.pickerDescription")
    : t("settingsMisc.snapShot.description");
}

export function snapShotAccessibilityUnavailableMessage(
  state: DesktopSnapShotState | null,
  t: Translate = globalT,
): string | undefined {
  if (state?.mode !== "portal") return undefined;
  if (state.linuxBackend === "picker" || state.linuxBackend === "screenshot-portal")
    return t("settingsMisc.snapShot.screenshotOnly");
  return undefined;
}

export function snapShotUnavailableMessage(
  hasBridge: boolean,
  t: Translate = globalT,
): string | undefined {
  if (hasBridge) return undefined;
  return typeof window !== "undefined" && window.desktopBridge
    ? t("settingsMisc.snapShot.updateDesktopApp")
    : t("settingsMisc.snapShot.desktopOnly");
}

export function snapShotSoundPatch(sound: SnapShotSoundSelection): ClientSettingsPatch {
  return sound === "off"
    ? { snapShotPlaySound: false }
    : { snapShotPlaySound: true, snapShotSound: sound };
}

export function createRecordingRequestTracker() {
  let currentRequest: symbol | null = null;

  return {
    tryBegin() {
      if (currentRequest) return null;
      currentRequest = Symbol();
      return currentRequest;
    },
    clear() {
      currentRequest = null;
    },
    owns(request: symbol) {
      return currentRequest === request;
    },
  };
}
