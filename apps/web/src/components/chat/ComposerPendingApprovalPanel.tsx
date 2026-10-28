import { memo } from "react";
import { type PendingApproval } from "../../session-logic";
import { useT } from "~/i18n";
import { InlineButton } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { composerFloatingLayerProps } from "./composerEventScope";
import { cn } from "~/lib/utils";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  className?: string;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  className,
}: ComposerPendingApprovalPanelProps) {
  const t = useT();
  const Detail = approval.requestKind === "mcp-elicitation" ? "span" : "code";
  const fallbackLabel =
    approval.requestKind === "mcp-elicitation"
      ? t("composer.approval.title.appAccess")
      : approval.requestKind === "command"
        ? t("composer.approval.title.command")
        : approval.requestKind === "file-read"
          ? t("composer.approval.title.fileRead")
          : approval.requestKind === "permission"
            ? t("composer.approval.title.permission")
            : t("composer.approval.title.fileChange");
  const detailAriaLabel =
    approval.requestKind === "mcp-elicitation"
      ? t("composer.approval.detail.appAccess")
      : approval.requestKind === "command"
        ? t("composer.approval.detail.command")
        : approval.requestKind === "file-read"
          ? t("composer.approval.detail.fileRead")
          : approval.requestKind === "permission"
            ? t("composer.approval.detail.permission")
            : t("composer.approval.detail.fileChange");

  return (
    <span
      aria-label={fallbackLabel}
      className={cn("flex min-w-0 flex-1 flex-col items-start gap-1", className)}
      role="group"
    >
      <span className="flex w-full min-w-0 items-center gap-2 text-2xs text-muted-foreground">
        <span className="shrink-0 font-medium text-warning">{fallbackLabel}</span>
        {approval.appName ? <span className="min-w-0 truncate">{approval.appName}</span> : null}
        {approval.fullAccessOverride ? (
          <Popover>
            <PopoverTrigger openOnHover render={<InlineButton tone="muted" />}>
              {t("composer.approval.fullAccessOverride.question")}
            </PopoverTrigger>
            <PopoverPopup
              {...composerFloatingLayerProps}
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
        {pendingCount > 1 ? (
          <span className="ml-auto shrink-0 tabular-nums">1/{pendingCount}</span>
        ) : null}
      </span>
      <Detail
        aria-label={detailAriaLabel}
        className={cn(
          "block w-full min-w-0 overflow-auto text-xs text-foreground [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-scrollbar]:h-1.5",
          approval.requestKind === "mcp-elicitation"
            ? "max-h-20 whitespace-pre-wrap font-sans wrap-break-word"
            : "max-h-40 whitespace-pre-wrap font-mono wrap-anywhere",
        )}
        data-approval-detail="complete"
        tabIndex={0}
      >
        {approval.responseCapability === "not_resumable"
          ? t("composer.approval.notResumable")
          : approval.detail || fallbackLabel}
      </Detail>
      {approval.reason ? (
        <span className="w-full min-w-0 text-2xs text-muted-foreground wrap-break-word">
          {approval.reason}
        </span>
      ) : null}
    </span>
  );
});
