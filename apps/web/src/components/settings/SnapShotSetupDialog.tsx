import { PermissionChecklist, PermissionContinueButton } from "../permissions/PermissionChecklist";
import { usePermissionStatus } from "../permissions/usePermissionStatus";
import {
  isModifierPairShortcut,
  type DesktopSnapShotSetupAction,
  type DesktopSnapShotState,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { useT } from "~/i18n";
import { MacAccessibilityIcon, MacScreenRecordingIcon } from "../Icons";
import { CaptureShortcutConfig } from "./CaptureShortcutConfig";
import { Button } from "../ui/button";
import { Dialog, DialogDescription } from "../ui/dialog";
import { WizardSteps, WizardPopup, WizardHeader, WizardPanel, WizardFooter } from "../ui/wizard";
import {
  captureSetupAccessReady,
  captureSetupBackend,
  captureSetupCheckMessage,
  captureSetupDesktopName,
  captureSetupInitialStep,
  captureSetupShortcutReady,
  type CaptureSetupStep,
} from "./SnapShotSetupDialog.logic";

const SETUP_STEPS = ["access", "shortcut"] as const;

export function SnapShotSetupDialog({
  state,
  initialStep,
  wasEnabled,
  includeAccessibility,
  busy: actionBusy,
  error,
  shortcutInput,
  shortcutStatus,
  shortcutChanged,
  canSaveShortcut,
  onSaveShortcut,
  onEnable,
  onAction,
  onRefresh,
  onClose,
  onLeaveStep,
}: {
  state: DesktopSnapShotState;
  initialStep: CaptureSetupStep;
  wasEnabled: boolean;
  includeAccessibility: boolean;
  busy: boolean;
  error: string | null;
  shortcutInput: ReactNode;
  shortcutStatus: string | null | undefined;
  shortcutChanged: boolean;
  canSaveShortcut: boolean;
  onSaveShortcut: () => Promise<boolean>;
  onEnable: () => Promise<boolean>;
  onAction: (action: DesktopSnapShotSetupAction) => Promise<void>;
  onRefresh: () => Promise<DesktopSnapShotState | undefined>;
  onClose: (completed: boolean) => Promise<void>;
  onLeaveStep: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState(() => captureSetupInitialStep(state, initialStep));
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const busy = actionBusy || checking || configBusy;
  const backend = captureSetupBackend(state);
  const configShortcut = backend === "niri" || backend === "hyprland";
  const desktop = captureSetupDesktopName(state);
  const extension = state.gnomeExtension;
  const helper = backend === "hyprland" ? state.hyprlandHelper : state.kdeHelper;
  const helperBackend = backend === "kde" || backend === "hyprland";
  const installHelper = backend === "hyprland" ? "install-hyprland-helper" : "install-kde-helper";
  const removeHelper = backend === "hyprland" ? "remove-hyprland-helper" : "remove-kde-helper";
  const accessReady = captureSetupAccessReady(state);
  const permissionStatus = usePermissionStatus(
    async () => {
      const refreshed = await onRefresh();
      if (!refreshed?.macPermissions)
        throw new Error(t("settingsPages.snapShotSetup.permissionStatusUnavailable"));
      return refreshed.macPermissions;
    },
    state.macPermissions ?? { screenRecording: false, accessibility: false },
    Boolean(state.macPermissions) && step === "access" && !busy,
  );
  const macPermissions = state.macPermissions ? permissionStatus.status : undefined;
  const macPermissionsReady =
    !macPermissions ||
    permissionStatus.isReady(
      includeAccessibility ? ["screenRecording", "accessibility"] : ["screenRecording"],
    );
  const shortcutReady = captureSetupShortcutReady(state, shortcutChanged);
  const install = extension?.status === "not-installed" || extension?.status === "update-required";
  const enable = extension?.status === "disabled";
  const changeStep = (next: CaptureSetupStep) => {
    onLeaveStep();
    setChecked(false);
    setStep(next);
  };
  const checkAgain = async () => {
    if (busy) return;
    setChecking(true);
    setChecked(false);
    const refreshed = await onRefresh().finally(() => setChecking(false));
    setChecked(refreshed !== undefined);
  };
  const accessCopy =
    state.message && !macPermissions
      ? {
          title: t("settingsPages.snapShotSetup.retry.title"),
          description: t("settingsPages.snapShotSetup.retry.description"),
        }
      : backend === "gnome" && extension
        ? extension.status === "enabled" && !accessReady
          ? {
              title: t("settingsPages.snapShotSetup.checkAccess.title"),
              description: t("settingsPages.snapShotSetup.checkAccess.description"),
            }
          : {
              title: t(`settingsPages.snapShotSetup.gnome.${extension.status}.title`),
              description: t(`settingsPages.snapShotSetup.gnome.${extension.status}.description`),
            }
        : helperBackend
          ? helper?.status === "ready"
            ? {
                title: t("settingsPages.snapShotSetup.gnome.enabled.title"),
                description: t("settingsPages.snapShotSetup.gnome.enabled.description"),
              }
            : helper?.status === "error"
              ? {
                  title: t("settingsPages.snapShotSetup.helperError.title"),
                  description: t("settingsPages.snapShotSetup.helperError.description"),
                }
              : {
                  title:
                    helper?.status === "update-required"
                      ? t("settingsPages.snapShotSetup.helper.updateTitle")
                      : t("settingsPages.snapShotSetup.allow.title"),
                  description: t("settingsPages.snapShotSetup.helper.description"),
                }
          : backend === "niri"
            ? {
                title: t("settingsPages.snapShotSetup.gnome.enabled.title"),
                description: t("settingsPages.snapShotSetup.gnome.enabled.description"),
              }
            : backend === "picker"
              ? {
                  title: t("settingsPages.snapShotSetup.picker.title"),
                  description: t("settingsPages.snapShotSetup.picker.description"),
                }
              : {
                  title: t("settingsPages.snapShotSetup.allow.title"),
                  description:
                    backend === "portal"
                      ? t("settingsPages.snapShotSetup.allow.portal")
                      : macPermissions
                        ? macPermissionsReady
                          ? t("settingsPages.snapShotSetup.allow.macReady")
                          : t("settingsPages.snapShotSetup.allow.macPermissions")
                        : t("settingsPages.snapShotSetup.allow.default"),
                };
  const title =
    step === "access" ? accessCopy.title : t("settingsPages.snapShotSetup.shortcut.title");
  const description =
    step === "access"
      ? accessCopy.description
      : configShortcut
        ? t("settingsPages.snapShotSetup.shortcut.config")
        : state.mode === "portal"
          ? t("settingsPages.snapShotSetup.shortcut.portal")
          : t("settingsPages.snapShotSetup.shortcut.default");
  const stepIndex = SETUP_STEPS.indexOf(step);
  const details = [
    ...new Set(
      [
        error,
        ...(step === "access"
          ? [
              state.message,
              backend === "gnome" &&
              (extension?.status === "error" || extension?.status === "unsupported")
                ? extension.message
                : null,
              helperBackend && helper?.status === "error" ? helper.message : null,
            ]
          : []),
      ].filter((detail) => detail !== null),
    ),
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) void onClose(false);
      }}
    >
      <WizardPopup showCloseButton={!busy}>
        <WizardHeader
          title={
            desktop
              ? t("settingsPages.snapShotSetup.titleFor", { desktop })
              : t("settingsPages.snapShotSetup.title")
          }
        >
          <WizardSteps
            steps={SETUP_STEPS.map((id) => t(`settingsPages.snapShotSetup.step.${id}`))}
            currentStep={stepIndex}
            isStepDisabled={(index) => busy || index > stepIndex}
            onStepChange={(index) => {
              const next = SETUP_STEPS[index];
              if (next && next !== step) changeStep(next);
            }}
          />
        </WizardHeader>
        <WizardPanel>
          <div className="space-y-4 text-sm">
            <div className="space-y-2" aria-live="polite">
              <h3 className="flex items-center gap-2 font-medium">{title}</h3>
              <DialogDescription>{description}</DialogDescription>
            </div>
            {step === "access" ? (
              <>
                <p
                  role="status"
                  aria-atomic="true"
                  className={
                    checked && !busy && !error ? "text-xs text-muted-foreground" : "sr-only"
                  }
                >
                  {checked && !busy && !error ? captureSetupCheckMessage(state, t) : null}
                </p>
                {macPermissions ? (
                  <PermissionChecklist
                    busy={busy}
                    permissions={[
                      {
                        id: "screenRecording",
                        icon: <MacScreenRecordingIcon className="size-8 shrink-0 drop-shadow-sm" />,
                        title: t("settingsPages.snapShotSetup.mac.screenRecording.title"),
                        description: t(
                          "settingsPages.snapShotSetup.mac.screenRecording.description",
                        ),
                        granted: macPermissions.screenRecording,
                        onAllow: () => void onAction("allow-screen-recording"),
                      },
                      {
                        id: "accessibility",
                        icon: <MacAccessibilityIcon className="size-8 shrink-0 drop-shadow-sm" />,
                        title: t("settingsPages.snapShotSetup.mac.accessibility.title"),
                        description: includeAccessibility
                          ? t("settingsPages.snapShotSetup.mac.accessibility.description")
                          : t("settingsPages.snapShotSetup.mac.accessibility.optional"),
                        granted: macPermissions.accessibility,
                        onAllow: () => void onAction("allow-accessibility"),
                      },
                    ]}
                  />
                ) : null}
                {permissionStatus.error && macPermissions ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {permissionStatus.error}
                  </p>
                ) : null}
                {helperBackend && helper?.status === "error" ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void onAction(installHelper)}
                  >
                    {t("settingsPages.snapShotSetup.reinstallHelper")}
                  </Button>
                ) : null}
              </>
            ) : configShortcut ? (
              <CaptureShortcutConfig
                state={state}
                disabled={actionBusy || checking || !accessReady}
                onBusyChange={setConfigBusy}
                onSaved={onRefresh}
                onComplete={() => onClose(true)}
              />
            ) : (
              <div className="space-y-3">
                {shortcutInput}
                {shortcutStatus ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    {shortcutStatus}
                  </p>
                ) : null}
                {!shortcutChanged &&
                !state.shortcutRegistered &&
                !state.shortcutPending &&
                state.shortcutCanRetry !== false &&
                !isModifierPairShortcut(state.shortcut) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onAction("retry-shortcut")}
                  >
                    {state.mode === "portal"
                      ? t("settingsPages.snapShotSetup.shortcutPermissions")
                      : t("settingsPages.snapShotSetup.tryAgain")}
                  </Button>
                ) : null}
              </div>
            )}
            {step === "shortcut" && !accessReady ? (
              <p role="alert" className="text-destructive">
                {t("settingsPages.snapShotSetup.needsAttention")}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive">
                {t("settingsPages.snapShotSetup.stepFailed")}
              </p>
            ) : null}
            {details.length > 0 || (step === "access" && (backend === "gnome" || helperBackend)) ? (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {t("settingsPages.snapShotSetup.advanced")}
                </summary>
                <div className="mt-3 space-y-3">
                  {details.map((detail) => (
                    <p key={detail} className="break-words">
                      {detail}
                    </p>
                  ))}
                  {step === "access" && (backend === "gnome" || helperBackend) ? (
                    <p>{t("settingsPages.snapShotSetup.included")}</p>
                  ) : null}
                  {step === "access" && backend === "gnome" && extension?.status === "enabled" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void onAction("disable-extension")}
                    >
                      {t("settingsPages.snapShotSetup.disableExtension")}
                    </Button>
                  ) : null}
                  {step === "access" && helperBackend && helper?.status !== "not-installed" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void onAction(removeHelper)}
                    >
                      {t("settingsPages.snapShotSetup.removeHelper")}
                    </Button>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        </WizardPanel>
        <WizardFooter>
          {step !== "access" ? (
            <Button variant="ghost" disabled={busy} onClick={() => changeStep("access")}>
              {t("common.back")}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={() => void onClose(false)}>
            {wasEnabled ? t("common.close") : t("settingsPages.snapShotSetup.finishLater")}
          </Button>
          {step === "access" ? (
            helperBackend && !accessReady && helper?.status !== "ready" ? (
              <Button
                disabled={busy}
                aria-busy={busy}
                onClick={() =>
                  void (helper?.status === "error" ? checkAgain() : onAction(installHelper))
                }
              >
                {checking
                  ? t("settingsPages.snapShotSetup.checking")
                  : busy
                    ? t("settingsPages.snapShotSetup.installing")
                    : helper?.status === "error"
                      ? t("settingsPages.snapShotSetup.checkAgain")
                      : helper?.status === "update-required"
                        ? t("settingsPages.snapShotSetup.updateHelper")
                        : t("settingsPages.snapShotSetup.installHelper")}
              </Button>
            ) : backend === "gnome" && !accessReady && extension?.status !== "enabled" ? (
              <Button
                disabled={busy}
                aria-busy={checking}
                onClick={() =>
                  void (install
                    ? onAction("install-extension")
                    : enable
                      ? onAction("enable-extension")
                      : checkAgain())
                }
              >
                {checking
                  ? t("settingsPages.snapShotSetup.checking")
                  : busy
                    ? install
                      ? t("settingsPages.snapShotSetup.installing")
                      : enable
                        ? t("settingsPages.snapShotSetup.enabling")
                        : t("settingsPages.snapShotSetup.working")
                    : install
                      ? extension?.status === "update-required"
                        ? t("settingsPages.snapShotSetup.updateExtension")
                        : t("settingsPages.snapShotSetup.installExtension")
                      : enable
                        ? t("settingsPages.snapShotSetup.enableExtension")
                        : t("settingsPages.snapShotSetup.checkAgain")}
              </Button>
            ) : (
              <PermissionContinueButton
                ready={macPermissionsReady}
                busy={busy}
                onClick={async () => {
                  if (await onEnable()) changeStep("shortcut");
                }}
              >
                {busy
                  ? t("settingsPages.snapShotSetup.working")
                  : macPermissions
                    ? t("settingsPages.snapShotSetup.testAndContinue")
                    : backend === "direct"
                      ? t("settingsPages.snapShotSetup.allowCapture")
                      : !accessReady && !macPermissions
                        ? t("settingsPages.snapShotSetup.tryAgain")
                        : t("common.continue")}
              </PermissionContinueButton>
            )
          ) : !configShortcut ? (
            <Button
              disabled={
                busy || !accessReady || (shortcutChanged ? !canSaveShortcut : !shortcutReady)
              }
              onClick={async () => {
                if (!shortcutChanged || (await onSaveShortcut())) await onClose(true);
              }}
            >
              {busy
                ? t("settingsPages.snapShotSetup.saving")
                : shortcutChanged
                  ? t("settingsPages.snapShotSetup.saveAndFinish")
                  : t("common.done")}
            </Button>
          ) : null}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
