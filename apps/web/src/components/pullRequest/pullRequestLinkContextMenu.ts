import type { ContextMenuItem } from "@t3tools/contracts";
import {
  type SourceControlDefinition,
  UNKNOWN_SOURCE_CONTROL_CLIENT,
} from "@t3tools/client-runtime/source-control-clients";

import { t as globalT, type Translate } from "~/i18n";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";

import { toastManager } from "../ui/toast";

export type PullRequestLinkContextMenuAction = "copy-link" | "open-external";

export const openOnHostLabel = (host: SourceControlDefinition, t: Translate = globalT): string =>
  host === UNKNOWN_SOURCE_CONTROL_CLIENT
    ? t("pullRequestDetail.linkMenu.openOnHost")
    : t("pullRequestDetail.linkMenu.openOn", { host: host.label });

function pullRequestLinkContextMenuItems(
  openLabel: string,
  t: Translate,
): readonly ContextMenuItem<PullRequestLinkContextMenuAction>[] {
  return [
    { id: "copy-link", label: t("pullRequestDetail.linkMenu.copyLink"), icon: "copy" },
    { id: "open-external", label: openLabel },
  ];
}

export async function showPullRequestLinkContextMenu({
  url,
  openLabel,
  position,
  t = globalT,
}: {
  readonly url: string;
  readonly openLabel: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly t?: Translate;
}): Promise<void> {
  const api = readLocalApi();
  if (!api) return;
  let action: PullRequestLinkContextMenuAction | null = null;
  try {
    action = await api.contextMenu.show(pullRequestLinkContextMenuItems(openLabel, t), position);
  } catch {
    return;
  }
  try {
    if (action === "copy-link") await writeTextToClipboard(url, "link");
    else if (action === "open-external") await api.shell.openExternal(url);
  } catch {
    toastManager.add({
      type: "error",
      title:
        action === "copy-link"
          ? t("pullRequestDetail.linkMenu.copyFailed")
          : t("pullRequestDetail.linkMenu.openFailed"),
    });
  }
}
