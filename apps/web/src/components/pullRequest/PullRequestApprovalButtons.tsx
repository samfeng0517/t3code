import { capitalizeTerm } from "@t3tools/client-runtime/source-control-clients";
import type { EnvironmentId, PullRequestAction, PullRequestRef } from "@t3tools/contracts";
import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";

import { useT } from "~/i18n";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import type { PerformPullRequestAction } from "./PullRequestDetailActions";
import { useInlineActionConfirm } from "./useInlineActionConfirm";

function ReservedLabel({ labels, shown }: { labels: ReadonlyArray<string>; shown: string }) {
  return (
    <span className="inline-grid">
      {labels.map((label) => (
        <span key={label} aria-hidden className="invisible col-start-1 row-start-1">
          {label}
        </span>
      ))}
      <span className="col-start-1 row-start-1">{shown}</span>
    </span>
  );
}

export function PullRequestApprovalButtons({
  pullRequestKey,
  environmentId,
  reference,
  term,
  canApprove,
  canUnapprove,
  pendingAction,
  perform,
  onApproved,
}: {
  pullRequestKey: string;
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  term: string;
  canApprove: boolean;
  canUnapprove: boolean;
  pendingAction: PullRequestAction | null;
  perform: PerformPullRequestAction;
  onApproved: () => void;
}) {
  const t = useT();
  const inlineConfirm = useInlineActionConfirm(pullRequestKey);
  const submitReview = useAtomCommand(pullRequestEnvironment.submitReview, {
    reportFailure: false,
  });
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const approveSending = sendingKey === pullRequestKey;
  const disabled = pendingAction !== null || approveSending;
  if (!canApprove && !canUnapprove) return null;

  const approve = async () => {
    if (disabled) return;
    setSendingKey(pullRequestKey);
    const result = await submitReview({
      environmentId,
      input: { ...reference, verdict: "approve", body: "", comments: [] },
    });
    setSendingKey(null);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: t("pullRequestDetail.reviewForm.submitFailed") });
      return;
    }
    toastManager.add({
      type: "success",
      title: t("pullRequestDetail.reviewForm.sent.approve", { singular: capitalizeTerm(term) }),
    });
    onApproved();
  };

  const unapprove = async () => {
    if (await perform("unapprove")) {
      toastManager.add({ type: "success", title: t("pullRequestDetail.actionSuccess.unapprove") });
    }
  };

  const approveLabel = t("pullRequestDetail.reviewForm.verdict.approve");
  const confirmApproveLabel = t("pullRequestDetail.action.confirmApprove");
  const approvingLabel = t("pullRequestDetail.action.approving");
  const revokeLabel = t("pullRequestDetail.action.revokeApproval");
  const revokingLabel = t("pullRequestDetail.action.revokingApproval");

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {canUnapprove ? (
        <Button size="xs" variant="outline" disabled={disabled} onClick={() => void unapprove()}>
          <RotateCcwIcon aria-hidden className="size-3.5" />
          <ReservedLabel
            labels={[revokeLabel, revokingLabel]}
            shown={pendingAction === "unapprove" ? revokingLabel : revokeLabel}
          />
        </Button>
      ) : null}
      {canApprove ? (
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          {...inlineConfirm.props("approve", () => void approve())}
        >
          <CheckIcon aria-hidden className="size-3.5" />
          <ReservedLabel
            labels={[approveLabel, confirmApproveLabel, approvingLabel]}
            shown={
              approveSending
                ? approvingLabel
                : inlineConfirm.isArmed("approve")
                  ? confirmApproveLabel
                  : approveLabel
            }
          />
        </Button>
      ) : null}
    </span>
  );
}
