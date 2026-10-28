import type { GitHistoryRefsResult, VcsStatusResult } from "@t3tools/contracts";
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  CloudDownloadIcon,
  RefreshCwIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "~/i18n";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SHORT_HASH_LENGTH } from "./gitHistoryState";
import type { GitWriteActions } from "./useGitWriteActions";

// Splits the translated sentence around the branch so the name can be bold in any word order.
const BRANCH_SLOT = "\u0000";

function BranchLabel(props: {
  readonly refs: GitHistoryRefsResult;
  readonly status: VcsStatusResult | null;
}) {
  const t = useT();
  const { refs, status } = props;
  const branch = refs.head.branch;
  if (branch === null) {
    if (refs.head.hash === null) return null;
    return (
      <span className="truncate text-muted-foreground">
        {t("git.toolbar.detachedHead", { hash: refs.head.hash.slice(0, SHORT_HASH_LENGTH) })}
      </span>
    );
  }
  const [before = "", after = ""] = t("git.toolbar.currentBranch", { branch: BRANCH_SLOT }).split(
    BRANCH_SLOT,
  );
  return (
    <span className="min-w-0 truncate text-muted-foreground">
      {before}
      <span className="font-semibold text-foreground">{branch}</span>
      {after}
      {status?.hasUpstream
        ? ` · ${t("git.toolbar.aheadBehind", { ahead: status.aheadCount, behind: status.behindCount })}`
        : null}
    </span>
  );
}

function WriteButton(props: {
  readonly kind: "fetch" | "pull" | "push";
  readonly label: string;
  readonly icon: ReactNode;
  readonly writes: GitWriteActions;
  /** Why this write is unavailable even when the page is idle and online. */
  readonly blockedReason: string | null;
}) {
  const t = useT();
  const { writes } = props;
  const reason = writes.isOnline ? props.blockedReason : t("git.toolbar.offline");
  const button = (
    <Button
      variant="outline"
      size="sm"
      disabled={reason !== null || writes.pending !== null}
      onClick={() => void writes[props.kind]()}
    >
      {writes.pending === props.kind ? <Spinner /> : props.icon}
      {props.label}
    </Button>
  );
  if (reason === null) return button;
  // A disabled button gets no pointer events, so the span carries the hover.
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>{button}</TooltipTrigger>
      <TooltipPopup>{reason}</TooltipPopup>
    </Tooltip>
  );
}

export function GitToolbar(props: {
  readonly refs: GitHistoryRefsResult | null;
  readonly status: VcsStatusResult | null;
  readonly onRefresh: (() => void) | null;
  readonly writes: GitWriteActions;
  /** Leads the toolbar; the narrow layout puts its refs sheet toggle here. */
  readonly leadingSlot?: ReactNode;
}) {
  const t = useT();
  const { refs, writes } = props;
  const detached = refs?.head.branch === null;
  return (
    <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-xs">
      {props.leadingSlot}
      {refs?.isRepo && writes.canWrite ? (
        <>
          <WriteButton
            kind="fetch"
            label={t("git.toolbar.fetch")}
            icon={<CloudDownloadIcon />}
            writes={writes}
            blockedReason={null}
          />
          <WriteButton
            kind="pull"
            label={t("git.toolbar.pull")}
            icon={<ArrowDownToLineIcon />}
            writes={writes}
            blockedReason={detached ? t("git.toolbar.pullDetached") : null}
          />
          <WriteButton
            kind="push"
            label={t("git.toolbar.push")}
            icon={<ArrowUpFromLineIcon />}
            writes={writes}
            blockedReason={detached ? t("git.toolbar.pushDetached") : null}
          />
        </>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t("git.toolbar.refresh")}
              disabled={props.onRefresh === null}
              onClick={props.onRefresh ?? undefined}
            >
              <RefreshCwIcon />
            </Button>
          }
        />
        <TooltipPopup>{t("git.toolbar.refresh")}</TooltipPopup>
      </Tooltip>
      {props.refs?.isRepo ? <BranchLabel refs={props.refs} status={props.status} /> : null}
    </div>
  );
}
