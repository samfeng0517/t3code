import { FolderPlusIcon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { useT } from "~/i18n";
import { Button } from "../ui/button";
import { SidebarInput } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarLayerHeader } from "./SidebarLayerHeader";

export interface SidebarThreadHeaderProps {
  searchFieldRef?: RefObject<HTMLDivElement | null>;
  hasProjects: boolean;
  projectScope: ReactNode;
  onNewProject: () => void;
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  showNewThreadInProjectHint: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
}

export function SidebarThreadHeader({
  searchFieldRef,
  hasProjects,
  projectScope,
  onNewProject,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
}: SidebarThreadHeaderProps) {
  const t = useT();
  const resultsVisible = isSearching && searchResultCount > 0;
  // Shrinking results can remove the active option; never leave aria-activedescendant pointing at it.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;
  const newThreadLabel = newThreadShortcutLabel
    ? t("sidebar.header.newThreadWithShortcut", { shortcut: newThreadShortcutLabel })
    : t("sidebar.header.newThread");

  return (
    <div className="flex flex-col gap-1">
      <SidebarLayerHeader label={t("sidebar.header.title")}>
        {hasProjects ? (
          <SidebarHeaderIconButton label={t("sidebar.header.addProject")} onClick={onNewProject}>
            <FolderPlusIcon className="size-3.5" />
          </SidebarHeaderIconButton>
        ) : null}
        <SidebarHeaderIconButton
          label={t("sidebar.header.newThread")}
          tooltip={
            showNewThreadInProjectHint ? (
              <span className="flex flex-col gap-0.5">
                <span>{newThreadLabel}</span>
                <span className="text-muted-foreground">
                  {newThreadInProjectShortcutLabel
                    ? t("sidebar.header.newThreadInProjectHintWithShortcut", {
                        shortcut: newThreadInProjectShortcutLabel,
                      })
                    : t("sidebar.header.newThreadInProjectHint")}
                </span>
              </span>
            ) : (
              newThreadLabel
            )
          }
          disabled={newThreadDisabled}
          onClick={onNewThread}
        >
          <SquarePenIcon className="size-3.5" />
        </SidebarHeaderIconButton>
      </SidebarLayerHeader>
      <div
        ref={searchFieldRef}
        className="flex h-8 min-w-0 items-center gap-2 rounded-md bg-sidebar-row-hover ps-2 pe-1 text-sm text-sidebar-muted-foreground focus-within:text-sidebar-foreground focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring/70"
      >
        <SearchIcon className="size-3.5 shrink-0 text-(--sidebar-icon-color)" />
        <SidebarInput
          ref={searchInputRef}
          nativeInput
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={t("sidebar.header.searchThreads")}
          aria-label={t("sidebar.header.searchThreads")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={resultsVisible}
          aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
          aria-activedescendant={
            activeResultExists
              ? `sidebar-thread-search-result-${activeSearchResultIndex}`
              : undefined
          }
          className="min-w-0 flex-1"
        />
        {isSearching ? (
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            className="shrink-0"
            aria-label={t("sidebar.header.clearSearch")}
            onClick={() => {
              onClearSearch();
              searchInputRef.current?.focus();
            }}
          >
            <XIcon className="size-3" />
          </Button>
        ) : null}
        {hasProjects ? projectScope : null}
      </div>
    </div>
  );
}

export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  children,
  ...rest
}: {
  label: string;
  tooltip?: ReactNode;
  children?: ReactNode;
} & Omit<ComponentProps<typeof Button>, "children" | "className" | "aria-label">) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button size="icon-xs" variant="ghost-muted" type="button" aria-label={label} {...rest} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
