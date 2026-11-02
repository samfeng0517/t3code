import { TriangleAlertIcon } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, type ReactNode, useId } from "react";

import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "~/hooks/useResizableWidth";
import { useT } from "~/i18n";
import { cn } from "~/lib/utils";

import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import { GIT_DETAIL_WIDTH_OPTIONS } from "./gitGraphStyle";
import { GitWorkingTreeDiff } from "./GitWorkingTreeDiff";
import type {
  WorkingTreeFileSelection,
  WorkingTreeLetter,
  WorkingTreeRow,
} from "./gitWorkingTreeState";
import type { GitWorkingTreeController } from "./useGitWorkingTree";

const LETTER_CLASSES: Record<WorkingTreeLetter, string> = {
  M: "text-warning",
  A: "text-success",
  U: "text-success",
  D: "text-destructive",
  R: "text-info",
};

const rowKey = (row: WorkingTreeFileSelection) => `${row.section}:${row.path}`;

function splitPath(path: string) {
  const slash = path.lastIndexOf("/");
  return slash === -1
    ? { name: path, directory: "" }
    : { name: path.slice(slash + 1), directory: path.slice(0, slash) };
}

function WorkingTreeFileRow(props: {
  readonly id: string;
  readonly row: WorkingTreeRow;
  readonly selected: boolean;
  readonly onSelect: (selection: WorkingTreeFileSelection) => void;
}) {
  const t = useT();
  const { row } = props;
  const { name, directory } = splitPath(row.path);
  return (
    <div
      id={props.id}
      role="option"
      aria-selected={props.selected}
      className={cn(
        "flex min-w-0 cursor-default items-center gap-1.5 px-3 py-0.5 text-xs",
        props.selected && "bg-accent",
      )}
      onClick={() => props.onSelect({ section: row.section, path: row.path })}
    >
      <span className={cn("w-3.5 shrink-0 font-mono font-semibold", LETTER_CLASSES[row.letter])}>
        {row.letter}
      </span>
      <span className="min-w-0 truncate">
        <span className="text-foreground">{name}</span>
        {directory.length > 0 ? (
          <span className="ml-1.5 text-muted-foreground">{directory}</span>
        ) : null}
      </span>
      {row.conflicted ? (
        <Badge variant="error" size="sm">
          {t("git.workingTree.conflict")}
        </Badge>
      ) : null}
    </div>
  );
}

function WorkingTreeSection(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div role="group" aria-label={props.title}>
      <div className="px-3 pt-2 pb-1 text-xs text-muted-foreground">{props.title}</div>
      {props.children}
    </div>
  );
}

function GitWorkingTreeSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2 px-3 py-2.5">
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

/** The uncommitted changes: staged and unstaged files on the left, the selected file's diff on the right. */
export function GitWorkingTreePanel(props: {
  readonly controller: GitWorkingTreeController;
  readonly headerAccessory?: ReactNode;
  /** Shown between the header and the file sections. */
  readonly actions?: ReactNode;
}) {
  const t = useT();
  const { controller } = props;
  const { sections, selection } = controller;
  const rowIdPrefix = useId();
  // Paths can hold whitespace, which ids cannot, so rows are named by position.
  const rowId = (index: number) => `${rowIdPrefix}-${index}`;
  const { width, handlers } = useResizableWidth(GIT_DETAIL_WIDTH_OPTIONS);

  if (controller.status === null) {
    if (controller.statusError === null) return <GitWorkingTreeSkeleton />;
    return (
      <Empty className="min-h-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{t("git.workingTree.loadFailed")}</EmptyTitle>
        </EmptyHeader>
        <Button variant="outline" size="sm" onClick={() => void controller.reload()}>
          {t("git.history.retry")}
        </Button>
      </Empty>
    );
  }

  const rows = [...sections.staged, ...sections.unstaged];
  const selectedIndex =
    selection === null ? -1 : rows.findIndex((row) => rowKey(row) === rowKey(selection));

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const nextIndex =
      selectedIndex === -1
        ? 0
        : event.key === "ArrowUp"
          ? Math.max(0, selectedIndex - 1)
          : Math.min(rows.length - 1, selectedIndex + 1);
    const next = rows[nextIndex];
    if (next === undefined) return;
    controller.select({ section: next.section, path: next.path });
    document.getElementById(rowId(nextIndex))?.scrollIntoView({ block: "nearest" });
  };

  const renderRows = (sectionRows: ReadonlyArray<WorkingTreeRow>, offset: number) =>
    sectionRows.map((row, index) => (
      <WorkingTreeFileRow
        key={rowKey(row)}
        id={rowId(offset + index)}
        row={row}
        selected={offset + index === selectedIndex}
        onSelect={controller.select}
      />
    ));

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div
        className="relative flex shrink-0 flex-col border-r border-border"
        style={
          {
            [RESIZABLE_WIDTH_PROPERTY]: `${width}px`,
            width: `var(${RESIZABLE_WIDTH_PROPERTY})`,
          } as CSSProperties
        }
      >
        <RightPanelResizeHandle handlers={handlers} className="left-auto -right-1" />
        <div className="flex min-w-0 shrink-0 items-start gap-2 px-3 py-2.5">
          <h2 className="min-w-0 flex-1 text-sm font-semibold">{t("git.workingTree.title")}</h2>
          {props.headerAccessory}
        </div>
        {props.actions}
        <div
          role="listbox"
          tabIndex={0}
          aria-label={t("git.workingTree.title")}
          aria-activedescendant={selectedIndex === -1 ? undefined : rowId(selectedIndex)}
          className="min-h-0 flex-1 overflow-y-auto pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onKeyDown={handleKeyDown}
        >
          {sections.staged.length > 0 ? (
            <WorkingTreeSection
              title={t("git.workingTree.staged", { count: sections.staged.length })}
            >
              {renderRows(sections.staged, 0)}
            </WorkingTreeSection>
          ) : null}
          {sections.unstaged.length > 0 ? (
            <WorkingTreeSection
              title={t("git.workingTree.unstaged", { count: sections.unstaged.length })}
            >
              {renderRows(sections.unstaged, sections.staged.length)}
            </WorkingTreeSection>
          ) : null}
        </div>
      </div>
      <GitWorkingTreeDiff
        diff={controller.diff}
        loading={controller.diffLoading}
        error={controller.diffError}
        onRetry={controller.retryDiff}
      />
    </div>
  );
}
