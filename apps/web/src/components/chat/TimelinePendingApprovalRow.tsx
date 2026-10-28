import { ShieldIcon } from "lucide-react";
import { memo, use } from "react";
import { type PendingApproval } from "../../session-logic";
import { type MessageKey, useT } from "~/i18n";
import { InlineButton } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { ToolActivityIconView, type WorkEntryIconName } from "./TimelineToolActivityIcon";
import { TimelineRowCtx } from "./timelineRowContext";
import { WorkLogRow } from "./WorkLog";

const APPROVAL_PRESENTATION = {
  command: {
    icon: "terminal",
    label: "composer.approval.title.command",
    detailLabel: "composer.approval.detail.command",
  },
  "file-change": {
    icon: "square-pen",
    label: "composer.approval.title.fileChange",
    detailLabel: "composer.approval.detail.fileChange",
  },
  "file-read": {
    icon: "eye",
    label: "composer.approval.title.fileRead",
    detailLabel: "composer.approval.detail.fileRead",
  },
  permission: {
    icon: "wrench",
    label: "composer.approval.title.permission",
    detailLabel: "composer.approval.detail.permission",
  },
  "mcp-elicitation": {
    icon: "hammer",
    label: "composer.approval.title.appAccess",
    detailLabel: "composer.approval.detail.appAccess",
  },
} satisfies Record<
  PendingApproval["requestKind"],
  { icon: WorkEntryIconName; label: MessageKey; detailLabel: MessageKey }
>;

export const TimelinePendingApprovalRow = memo(function TimelinePendingApprovalRow({
  approval,
}: {
  approval: PendingApproval;
}) {
  const t = useT();
  const { respondingRequestIds, canOperateThread, onRespondToApproval } = use(TimelineRowCtx);
  const presentation = APPROVAL_PRESENTATION[approval.requestKind];
  const label = t(presentation.label);
  const canRespond = approval.responseCapability === "live";
  return (
    <WorkLogRow
      role="group"
      aria-label={label}
      data-v2-item-type="approval_request"
      wrapLabel
      icon={
        <ToolActivityIconView
          icon={undefined}
          fallbackName={presentation.icon}
          className="block size-4 shrink-0 stroke-2 text-icon-muted"
          muted
        />
      }
      label={
        <code
          aria-label={t(presentation.detailLabel)}
          className="block max-h-40 min-w-0 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-foreground select-text! wrap-anywhere [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
          data-approval-detail="complete"
          tabIndex={0}
        >
          {approval.detail || label}
        </code>
      }
    >
      <div className="ms-7.5 flex min-w-0 flex-col gap-1 pb-1 text-xs">
        {approval.appName ? (
          <span className="text-muted-foreground wrap-anywhere">{approval.appName}</span>
        ) : null}
        {approval.reason ? (
          <span className="text-muted-foreground select-text wrap-anywhere">{approval.reason}</span>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {canRespond ? (
            <>
              <span className="inline-flex items-center gap-1 text-warning">
                <ShieldIcon aria-hidden className="size-3 shrink-0" />
                Waiting for approval
              </span>
              {onRespondToApproval ? (
                <>
                  <span aria-hidden className="text-muted-foreground">
                    ·
                  </span>
                  <ComposerPendingApprovalActions
                    presentation="inline"
                    requestId={approval.requestId}
                    disabled={!canOperateThread}
                    isResponding={respondingRequestIds.includes(approval.requestId)}
                    canRespond={canRespond}
                    options={approval.options}
                    onRespondToApproval={onRespondToApproval}
                  />
                </>
              ) : null}
            </>
          ) : (
            <span className="text-warning">{t("composer.approval.notResumable")}</span>
          )}
          {approval.fullAccessOverride ? (
            <Popover>
              <PopoverTrigger openOnHover render={<InlineButton tone="muted" />}>
                {t("composer.approval.fullAccessOverride.question")}
              </PopoverTrigger>
              <PopoverPopup
                aria-label={t("composer.approval.fullAccessOverride.question")}
                tooltipStyle
                side="top"
                className="max-w-[min(22rem,calc(100vw-2rem))] whitespace-normal"
              >
                {approval.fullAccessOverride === "ask_rule"
                  ? t("composer.approval.fullAccessOverride.askRule")
                  : t("composer.approval.fullAccessOverride.safetyCheck")}
              </PopoverPopup>
            </Popover>
          ) : null}
        </div>
      </div>
    </WorkLogRow>
  );
});
