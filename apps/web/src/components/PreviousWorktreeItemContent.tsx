import { HistoryIcon } from "lucide-react";

import { useT } from "~/i18n";
import { MiddleTruncate } from "./ui/middle-truncate";

export function PreviousWorktreeItemContent({ branch }: { branch: string | null }) {
  const t = useT();
  return (
    <span className="flex min-w-0 items-start gap-1.5">
      <HistoryIcon className="mt-1 size-3" />
      <span className="flex min-w-0 flex-col">
        <span>{t("branchToolbar.workspace.previousWorktree")}</span>
        {branch ? (
          <span className="min-w-0 text-xs text-muted-foreground">
            <MiddleTruncate value={branch} />
          </span>
        ) : null}
      </span>
    </span>
  );
}
