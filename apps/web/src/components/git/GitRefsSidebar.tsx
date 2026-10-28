import type { GitHistoryRefsResult } from "@t3tools/contracts";
import { LegendList } from "@legendapp/list/react";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { type MessageKey, useT } from "~/i18n";
import { cn } from "~/lib/utils";

import type { GitOpenMenu } from "./gitContextMenus";
import {
  buildRefsSidebarRows,
  type GitRefsGroup,
  type GitRefsSidebarRow,
} from "./gitRefsSidebarRows";

/**
 * `select: true` jumps to the commit and selects its graph row. `select: false` is for stashes:
 * the hash is the stash commit, shown in the detail while the graph only scrolls to its base.
 */
type GitSelectRef = (hash: string, opts: { readonly select: boolean }) => void;

const GROUP_TITLE_KEYS: Record<GitRefsGroup, MessageKey> = {
  branches: "git.refs.branches",
  remotes: "git.refs.remotes",
  tags: "git.refs.tags",
  stashes: "git.refs.stashes",
  worktrees: "git.refs.worktrees",
};

/** Matches an item row (`text-xs` plus `py-0.5`); headers are measured. */
const ESTIMATED_ROW_HEIGHT = 20;

function RefsSidebarRow(props: {
  readonly row: GitRefsSidebarRow;
  readonly onSelectRef: GitSelectRef;
  readonly onToggle: (key: string) => void;
  readonly onOpenMenu: GitOpenMenu;
}) {
  const t = useT();
  const { row } = props;
  switch (row.kind) {
    case "header": {
      const Chevron = row.collapsed ? ChevronRightIcon : ChevronDownIcon;
      return (
        <button
          type="button"
          aria-expanded={!row.collapsed}
          className="flex w-full min-w-0 items-center gap-0.5 rounded px-1 pt-2 pb-1 text-left text-2xs tracking-wide text-muted-foreground uppercase hover:text-foreground"
          onClick={() => props.onToggle(row.key)}
        >
          <Chevron aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{t(GROUP_TITLE_KEYS[row.group])}</span>
        </button>
      );
    }
    case "remote": {
      const Chevron = row.collapsed ? ChevronRightIcon : ChevronDownIcon;
      return (
        <button
          type="button"
          aria-expanded={!row.collapsed}
          className="flex w-full min-w-0 items-center gap-0.5 rounded py-0.5 pr-1.5 pl-1 text-left text-xs hover:bg-accent"
          onClick={() => props.onToggle(row.key)}
        >
          <Chevron aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{row.remote}</span>
        </button>
      );
    }
    case "ref": {
      const { target, menu } = row;
      return (
        <button
          type="button"
          disabled={target === null}
          className={cn(
            "relative flex w-full min-w-0 items-center rounded py-0.5 pr-1.5 text-left text-xs hover:bg-accent disabled:pointer-events-none disabled:text-muted-foreground",
            row.nested ? "pl-7" : "pl-4",
            row.current && "font-semibold text-foreground",
          )}
          onClick={
            target === null
              ? undefined
              : () => props.onSelectRef(target.hash, { select: target.select })
          }
          onContextMenu={(event) => {
            if (menu === null) return;
            event.preventDefault();
            props.onOpenMenu(menu, { x: event.clientX, y: event.clientY });
          }}
        >
          {row.current ? (
            <CheckIcon aria-hidden className="absolute left-0.5 size-3 text-success" />
          ) : null}
          <span className="truncate">{row.label}</span>
        </button>
      );
    }
  }
}

export function GitRefsSidebar(props: {
  readonly refs: GitHistoryRefsResult;
  readonly onSelectRef: GitSelectRef;
  /** Must keep one identity: rows render only when their data changes. */
  readonly onOpenMenu: GitOpenMenu;
}) {
  const { refs, onSelectRef, onOpenMenu } = props;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  // Repositories can carry thousands of tags and remote branches; only rows in view mount.
  const rows = buildRefsSidebarRows(refs, collapsed);

  return (
    <nav className="flex h-full min-h-0 w-52.5 shrink-0 flex-col border-r border-border">
      <LegendList<GitRefsSidebarRow>
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        renderItem={({ item: row }) => (
          <RefsSidebarRow
            row={row}
            onSelectRef={onSelectRef}
            onToggle={toggle}
            onOpenMenu={onOpenMenu}
          />
        )}
        estimatedItemSize={ESTIMATED_ROW_HEIGHT}
        drawDistance={ESTIMATED_ROW_HEIGHT * 20}
        className="min-h-0 flex-1 overscroll-contain px-1.5 pb-2"
      />
    </nav>
  );
}
