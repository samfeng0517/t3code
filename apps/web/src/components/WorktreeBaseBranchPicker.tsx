import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { useT } from "~/i18n";
import { usePaginatedBranches } from "../state/queries";
import { BranchPicker, BranchPickerRefItem } from "./BranchPicker";
import { resolveBranchTriggerLabel, sanitizeNewRefName } from "./BranchToolbar.logic";
import { MiddleTruncate } from "./ui/middle-truncate";
import { Button } from "./ui/button";
import { ComboboxTrigger } from "./ui/combobox";

export function WorktreeBaseBranchPicker({
  environmentId,
  cwd,
  value,
  onValueChange,
  startFromOrigin,
  onStartFromOriginChange,
  disabled = false,
  id,
}: {
  environmentId: EnvironmentId;
  cwd: string | null;
  value: string;
  onValueChange: (branch: string) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const branches = usePaginatedBranches({
    environmentId,
    cwd,
    query: sanitizeNewRefName(deferredQuery),
  });
  const label = resolveBranchTriggerLabel(
    {
      activeWorktreePath: null,
      effectiveEnvMode: "worktree",
      resolvedActiveBranch: value || null,
    },
    t,
  );
  const branchByName = new Map(branches.refs.map((branch) => [branch.name, branch]));
  const items = [...branchByName.keys()];
  const hasNextPage = branches.data?.nextCursor != null;
  const statusText =
    branches.error ??
    (branches.isPending && branches.data === null
      ? t("branchToolbar.branch.loadingRefs")
      : branches.isFetchingNextPage
        ? t("branchToolbar.branch.loadingMoreRefs")
        : hasNextPage
          ? t("branchToolbar.branch.showingRefs", {
              shown: branches.refs.length,
              total: branches.data?.totalCount ?? 0,
            })
          : null);
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  return (
    <BranchPicker
      items={items}
      filteredItems={items}
      value={value || null}
      query={query}
      onQueryChange={setQuery}
      open={open && !disabled}
      onOpenChange={handleOpenChange}
      onSelectItem={(name) => {
        onValueChange(name);
        handleOpenChange(false);
      }}
      hasNextPage={hasNextPage}
      isFetchingNextPage={branches.isFetchingNextPage}
      onLoadNext={branches.loadNext}
      statusText={statusText}
      originControl={{ checked: startFromOrigin, onCheckedChange: onStartFromOriginChange }}
      popupProps={{ align: "start", side: "bottom", className: "flex w-80 flex-col" }}
      renderItem={(name, index) => {
        const branch = branchByName.get(name);
        return branch ? (
          <BranchPickerRefItem
            branch={branch}
            projectCwd={cwd}
            index={index}
            onClick={() => {
              onValueChange(branch.name);
              handleOpenChange(false);
            }}
          />
        ) : null;
      }}
    >
      <ComboboxTrigger
        id={id}
        disabled={disabled || !cwd}
        render={<Button variant="outline" size="sm" />}
        className="w-full justify-between "
      >
        <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <MiddleTruncate value={label} className="flex-1 text-left" />
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </ComboboxTrigger>
    </BranchPicker>
  );
}
