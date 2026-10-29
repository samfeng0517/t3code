import { DownloadIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { RelayClientInstallProgressStage } from "@t3tools/contracts";

import {
  completeRelayClientInstallDialogClose,
  readRelayClientInstallDialogState,
  respondToRelayClientInstallConfirmation,
  subscribeRelayClientInstallDialog,
} from "../../cloud/relayClientInstallDialog";
import { useT, type MessageKey } from "~/i18n";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
const installSteps: ReadonlyArray<{
  readonly stage: RelayClientInstallProgressStage;
  readonly label: MessageKey;
}> = [
  { stage: "checking", label: "files.relayInstall.step.checking" },
  { stage: "waiting_for_lock", label: "files.relayInstall.step.waiting_for_lock" },
  { stage: "downloading", label: "files.relayInstall.step.downloading" },
  { stage: "verifying", label: "files.relayInstall.step.verifying" },
  { stage: "installing", label: "files.relayInstall.step.installing" },
  { stage: "validating", label: "files.relayInstall.step.validating" },
  { stage: "activating", label: "files.relayInstall.step.activating" },
];

export function RelayClientInstallDialog() {
  const t = useT();
  const state = useSyncExternalStore(
    subscribeRelayClientInstallDialog,
    readRelayClientInstallDialogState,
    readRelayClientInstallDialogState,
  );
  const view = state.status === "closing" ? state.view : state;
  const isConfirming = view.status === "confirming";
  const isInstalling = view.status === "installing";
  const activeStepIndex = isInstalling
    ? installSteps.findIndex(({ stage }) => stage === view.stage)
    : -1;
  const activeStep = installSteps[activeStepIndex];

  return (
    <Dialog
      open={state.status === "confirming" || state.status === "installing"}
      onOpenChange={(open) => {
        if (!open && isConfirming) {
          respondToRelayClientInstallConfirmation(false);
        }
      }}
      onOpenChangeComplete={(open) => {
        if (!open) {
          completeRelayClientInstallDialogClose();
        }
      }}
    >
      <DialogPopup className="max-w-md" showCloseButton={isConfirming}>
        <DialogHeader>
          <div className="flex size-9 items-center justify-center rounded-lg border border-border/70 bg-muted/60">
            <DownloadIcon aria-hidden className="size-4.5 text-muted-foreground" />
          </div>
          <DialogTitle>
            {isInstalling
              ? t("files.relayInstall.installingTitle")
              : t("files.relayInstall.confirmTitle")}
          </DialogTitle>
          <DialogDescription>
            {isInstalling
              ? t("files.relayInstall.installingDescription")
              : t("files.relayInstall.confirmDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel scrollFade={false}>
          {isInstalling ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <p aria-live="polite" className="font-medium text-foreground">
                  {activeStep ? t(activeStep.label) : null}
                </p>
                <p className="shrink-0 tabular-nums text-muted-foreground">
                  {t("files.relayInstall.progress", {
                    current: activeStepIndex + 1,
                    total: installSteps.length,
                  })}
                </p>
              </div>
              <progress
                aria-label={t("files.relayInstall.progressLabel")}
                className="h-2 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
                max={installSteps.length}
                value={activeStepIndex + 1}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("files.relayInstall.keepOpen")}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border/70 bg-muted/35 p-3">
              <p className="text-sm font-medium text-foreground">
                {t("files.relayInstall.managed")}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t("files.relayInstall.willInstall", {
                  version: view.status === "confirming" ? view.version : "",
                })}
              </p>
            </div>
          )}
        </DialogPanel>
        {isConfirming ? (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => respondToRelayClientInstallConfirmation(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={() => respondToRelayClientInstallConfirmation(true)}>
              {t("files.relayInstall.confirm")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
