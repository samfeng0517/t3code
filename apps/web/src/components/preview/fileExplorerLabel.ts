import type { ExecutionEnvironmentPlatformOs, FileManagerRevealKind } from "@t3tools/contracts";

import { t } from "~/i18n";

export function revealInFileExplorerLabel(platform: string): string {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac")) return t("workspace.reveal.finder");
  if (normalized.includes("win")) return t("workspace.reveal.fileExplorer");
  return t("workspace.reveal.files");
}

export function revealInFileExplorerLabelForOs(os: ExecutionEnvironmentPlatformOs): string {
  if (os === "darwin") return t("workspace.reveal.finder");
  if (os === "windows") return t("workspace.reveal.fileExplorer");
  return t("workspace.reveal.files");
}

export function revealInFileExplorerLabelForKind(kind: FileManagerRevealKind): string {
  if (kind === "finder") return t("workspace.reveal.finder");
  if (kind === "file-explorer") return t("workspace.reveal.fileExplorer");
  return t("workspace.reveal.files");
}
