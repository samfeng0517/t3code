import type { GitLogCommit } from "@t3tools/contracts";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { useEffect, useId, useRef } from "react";

import { useT } from "~/i18n";

import { Button } from "../ui/button";
import type { GitOpenMenu } from "./gitContextMenus";
import { GitGraphRow } from "./GitGraphRow";
import { GRAPH_ROW_HEIGHT } from "./gitGraphStyle";
import { nextSelectedHash } from "./gitHistoryState";
import type { GitHistoryController } from "./useGitHistory";

const NAVIGATION_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End"]);

const isNavigationKey = (key: string): key is "ArrowUp" | "ArrowDown" | "Home" | "End" =>
  NAVIGATION_KEYS.has(key);

/** A new object per request, so asking for the same commit twice scrolls twice. */
export interface GitGraphScrollTarget {
  readonly hash: string;
}

export function GitGraphList(props: {
  readonly controller: GitHistoryController;
  readonly selectedHash: string | null;
  readonly onSelect: (hash: string) => void;
  readonly scrollTarget: GitGraphScrollTarget | null;
  /** Must keep one identity: rows render only when their data changes. */
  readonly onOpenMenu: GitOpenMenu;
}) {
  const t = useT();
  const { controller, selectedHash, onSelect, scrollTarget, onOpenMenu } = props;
  const { state, layout, labels, refs } = controller;
  const commits = state.commits;
  const headHash = refs?.head.hash ?? null;
  const rowIdPrefix = useId();
  const rowId = (hash: string) => `${rowIdPrefix}-${hash}`;
  const listRef = useRef<LegendListRef | null>(null);

  // A jump can land before the list renders the pages it loaded, so the request waits here
  // until its commit is in the data.
  const handledScrollTarget = useRef<GitGraphScrollTarget | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the virtualized list, an imperative external API, once the target commit has rendered
  useEffect(() => {
    if (scrollTarget === null || handledScrollTarget.current === scrollTarget) return;
    const index = commits.findIndex((commit) => commit.hash === scrollTarget.hash);
    if (index === -1) return;
    handledScrollTarget.current = scrollTarget;
    void listRef.current?.scrollIndexIntoView({ index, animated: false });
  }, [scrollTarget, commits]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isNavigationKey(event.key)) return;
    event.preventDefault();
    const hashes = commits.map((commit) => commit.hash);
    const next = nextSelectedHash(hashes, selectedHash, event.key);
    if (next === null) return;
    onSelect(next);
    void listRef.current?.scrollIndexIntoView({ index: hashes.indexOf(next), animated: false });
  };

  const activeDescendant =
    selectedHash !== null && commits.some((commit) => commit.hash === selectedHash)
      ? rowId(selectedHash)
      : undefined;

  // Legend re-renders visible rows only when data or extraData changes, so everything the rows
  // read from outside their commit goes in here.
  const rowInputs = { layout, labels, headHash, selectedHash };

  return (
    <div
      role="listbox"
      tabIndex={0}
      aria-label={t("git.graph.label")}
      aria-activedescendant={activeDescendant}
      className="flex min-h-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onKeyDown={handleKeyDown}
    >
      <LegendList<GitLogCommit>
        ref={listRef}
        data={commits}
        extraData={rowInputs}
        keyExtractor={(commit) => commit.hash}
        renderItem={({ item: commit, index }) => (
          <GitGraphRow
            id={rowId(commit.hash)}
            commit={commit}
            row={layout.rows[index]}
            maxLanes={layout.maxLanes}
            labels={labels.get(commit.hash) ?? []}
            isHead={commit.hash === headHash}
            selected={commit.hash === selectedHash}
            onSelect={onSelect}
            onOpenMenu={onOpenMenu}
          />
        )}
        estimatedItemSize={GRAPH_ROW_HEIGHT}
        drawDistance={GRAPH_ROW_HEIGHT * 20}
        maintainVisibleContentPosition
        onEndReached={controller.loadMore}
        ListFooterComponent={
          state.loadMoreError === null ? null : (
            <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
              {t("git.history.loadFailed")}
              <Button variant="outline" size="xs" onClick={controller.loadMore}>
                {t("git.history.retry")}
              </Button>
            </div>
          )
        }
        className="min-h-0 flex-1 overscroll-contain"
      />
    </div>
  );
}
