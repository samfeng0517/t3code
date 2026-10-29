import { useState } from "react";

import { useT } from "~/i18n";
import { isLocalEnvironmentDisabled } from "../../localEnvironment";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

// Toggling relaunches desktop; the switch reflects startup state.
export function LocalEnvironmentSetting() {
  const t = useT();
  const setEnabled = window.desktopBridge?.setLocalEnvironmentEnabled;
  const [enabled] = useState(() => !isLocalEnvironmentDisabled());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!setEnabled) return null;

  const applyChange = async () => {
    setIsUpdating(true);
    setError(null);
    try {
      await setEnabled(!enabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settingsMisc.localEnv.couldNotChange"));
      setIsUpdating(false);
    }
  };

  return (
    <>
      <SettingsRow
        {...searchableSetting("local-environment", t)}
        description={
          enabled
            ? t("settingsMisc.localEnv.descriptionOn")
            : t("settingsMisc.localEnv.descriptionOff")
        }
        control={
          <Switch
            checked={enabled}
            disabled={isUpdating}
            onCheckedChange={() => setConfirmOpen(true)}
            aria-label={t("settingsMisc.localEnv.ariaLabel")}
          />
        }
      />
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (isUpdating) return;
          setConfirmOpen(open);
          if (!open) setError(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {enabled
                ? t("settingsMisc.localEnv.dialog.titleOff")
                : t("settingsMisc.localEnv.dialog.titleOn")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {enabled
                ? t("settingsMisc.localEnv.dialog.descriptionOff")
                : t("settingsMisc.localEnv.dialog.descriptionOn")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p className="px-6 pb-4 text-sm text-destructive">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogClose disabled={isUpdating} render={<Button variant="outline" />}>
              {t("common.cancel")}
            </AlertDialogClose>
            <Button
              variant={enabled ? "destructive" : "default"}
              disabled={isUpdating}
              onClick={() => void applyChange()}
            >
              {isUpdating ? (
                <>
                  <Spinner size="sm" />
                  {t("settingsMisc.localEnv.restarting")}
                </>
              ) : enabled ? (
                t("settingsMisc.localEnv.restartOff")
              ) : (
                t("settingsMisc.localEnv.restartOn")
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
