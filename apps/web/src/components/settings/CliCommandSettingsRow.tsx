import { useState } from "react";

import { useT } from "~/i18n";
import {
  desktopCliCommandStateAtom,
  getDesktopCliCommandBridge,
  refreshDesktopCliCommandState,
} from "~/state/desktopCliCommand";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function CliCommandSettingsRow() {
  const t = useT();
  const bridge = getDesktopCliCommandBridge();
  const query = useEnvironmentQuery(bridge ? desktopCliCommandStateAtom : null);
  const state = query.data;
  const [pending, setPending] = useState(false);

  const change = (action: "install" | "uninstall") => {
    if (!bridge || pending) return;
    setPending(true);
    void bridge[action]()
      .then(refreshDesktopCliCommandState)
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title:
              action === "install"
                ? t("providerSetup.cliCommand.installFailed")
                : t("providerSetup.cliCommand.removeFailed"),
            description:
              error instanceof Error ? error.message : t("providerSetup.cliCommand.genericError"),
          }),
        );
      })
      .finally(() => setPending(false));
  };

  if (!bridge || !state?.supported) return null;
  const installed = state.installedPath !== null;
  const description = state.shadowedBy
    ? t("providerSetup.cliCommand.shadowed", { path: state.shadowedBy })
    : !installed
      ? t("providerSetup.cliCommand.notInstalled")
      : state.onPath
        ? t("providerSetup.cliCommand.installed", { path: state.installedPath ?? "" })
        : t("providerSetup.cliCommand.notOnPath", { path: state.installedPath ?? "" });

  return (
    <SettingsRow
      {...searchableSetting("cli-command", t)}
      description={description}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={pending || query.isPending}
          onClick={() => change(installed ? "uninstall" : "install")}
        >
          {installed ? t("providerSetup.cliCommand.remove") : t("providerSetup.cliCommand.install")}
        </Button>
      }
    />
  );
}
