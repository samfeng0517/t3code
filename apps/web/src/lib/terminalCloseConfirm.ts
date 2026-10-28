import { t } from "~/i18n";
import { readLocalApi } from "~/localApi";

let pendingConfirmations = 0;

export function isTerminalCloseConfirmPending(): boolean {
  return pendingConfirmations > 0;
}

export async function confirmTerminalClose(
  labels: readonly [string, ...string[]],
): Promise<boolean> {
  const localApi = readLocalApi();
  if (!localApi) return true;
  pendingConfirmations += 1;
  try {
    return await localApi.dialogs.confirm(
      labels.length === 1
        ? [
            t("workspace.terminal.closeConfirm.singleTitle", { label: labels[0] }),
            t("workspace.terminal.closeConfirm.singleBody"),
          ].join("\n")
        : [
            t("workspace.terminal.closeConfirm.multiTitle", { count: labels.length }),
            t("workspace.terminal.closeConfirm.multiBody", {
              labels: labels.map((label) => `"${label}"`).join(", "),
            }),
          ].join("\n"),
      { variant: "destructive" },
    );
  } catch {
    return false;
  } finally {
    pendingConfirmations -= 1;
  }
}
