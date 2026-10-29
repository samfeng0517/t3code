import { EDITORS, type EditorId } from "@t3tools/contracts";

import { t as globalT, type Translate } from "~/i18n";
import { getLocalFileManagerName } from "~/lib/utils";

const editorLabels = new Map<EditorId, string>(EDITORS.map((editor) => [editor.id, editor.label]));

export function editorLabelForPlatform(editorId: EditorId, platform: string): string {
  if (editorId === "file-manager") {
    return getLocalFileManagerName(platform);
  }

  return editorLabels.get(editorId) ?? globalT("workspace.editor.fallback");
}

export function openInEditorMenuLabel(editorId: EditorId | null, t: Translate = globalT): string {
  return editorId === null || editorId === "file-manager"
    ? t("workspace.editor.openInEditor")
    : t("workspace.editor.openIn", {
        editor: editorLabels.get(editorId) ?? t("workspace.editor.fallback"),
      });
}
