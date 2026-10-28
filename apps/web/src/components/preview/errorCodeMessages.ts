import type { Translate } from "~/i18n";

import { PREVIEW_ERROR_CODE_MESSAGES } from "./previewConstants";

export function describePreviewError(description: string, t: Translate): string {
  const friendly = PREVIEW_ERROR_CODE_MESSAGES[description];
  if (friendly) return t(friendly);
  if (description.length > 0) return description;
  return t("workspace.preview.error.network");
}
