import {
  codexFeedbackNotice,
  type CodexFeedbackSubmission,
} from "@t3tools/client-runtime/state/threads";
import { MessageSquareIcon } from "lucide-react";

import { t as globalT, type Translate } from "~/i18n";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

export function feedbackBannerItem(
  submission: CodexFeedbackSubmission,
  onDismiss: () => void,
  t: Translate = globalT,
): ComposerBannerStackItem | null {
  const notice = codexFeedbackNotice(submission);
  if (!notice) return null;
  return {
    id: `feedback:${submission.id}`,
    variant:
      submission.status === "failed" ? "error" : submission.status === "sent" ? "success" : "info",
    icon: <MessageSquareIcon />,
    ...notice,
    actions:
      submission.status === "sent" ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            void writeTextToClipboard(submission.feedbackId, "Codex feedback thread ID").catch(
              (error: unknown) => {
                toastManager.add({
                  type: "error",
                  title: t("legacySidebar.misc.feedback.copyFailed"),
                  description: error instanceof Error ? error.message : t("common.errorOccurred"),
                });
              },
            );
          }}
        >
          {t("legacySidebar.misc.feedback.copyId")}
        </Button>
      ) : undefined,
    ...(submission.status !== "uploading"
      ? { dismissLabel: t("legacySidebar.misc.feedback.dismiss"), onDismiss }
      : {}),
  };
}
