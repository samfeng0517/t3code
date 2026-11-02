import type { GitLogCommit } from "@t3tools/contracts";

import { useT } from "~/i18n";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import type { GitOpenMenu } from "./gitContextMenus";
import type { GraphRow, GraphSegment } from "./gitGraphLayout";
import {
  GRAPH_LANE_WIDTH,
  GRAPH_NODE_RADIUS,
  GRAPH_ROW_HEIGHT,
  GRAPH_STROKE_WIDTH,
  laneFillClass,
  laneStrokeClass,
  laneX,
} from "./gitGraphStyle";
import { type GitRefLabel, SHORT_HASH_LENGTH } from "./gitHistoryState";
import { GitRefLabels } from "./GitRefLabels";
import { UNCOMMITTED_ROW_ID } from "./gitWorkingTreeState";

const MID_Y = GRAPH_ROW_HEIGHT / 2;

const graphWidth = (maxLanes: number) => Math.max(maxLanes, 1) * GRAPH_LANE_WIDTH;

/** Lane changes are S-curves with vertical tangents, so they meet straight lane lines cleanly. */
function segmentPath(segment: GraphSegment, nodeLane: number): string {
  const from = laneX(segment.fromLane);
  const to = laneX(segment.toLane);
  const node = laneX(nodeLane);
  switch (segment.kind) {
    case "through":
      return `M${from} 0 V${GRAPH_ROW_HEIGHT}`;
    case "top":
      return from === node
        ? `M${from} 0 V${MID_Y}`
        : `M${from} 0 C${from} ${MID_Y} ${node} 0 ${node} ${MID_Y}`;
    case "bottom":
      return to === node
        ? `M${node} ${MID_Y} V${GRAPH_ROW_HEIGHT}`
        : `M${node} ${MID_Y} C${node} ${GRAPH_ROW_HEIGHT} ${to} ${MID_Y} ${to} ${GRAPH_ROW_HEIGHT}`;
  }
}

function GraphCell(props: {
  readonly row: GraphRow;
  readonly maxLanes: number;
  readonly hollow: boolean;
  readonly connectAbove: boolean;
}) {
  const { row, maxLanes, hollow } = props;
  const width = graphWidth(maxLanes);
  return (
    <svg
      aria-hidden
      className="shrink-0"
      width={width}
      height={GRAPH_ROW_HEIGHT}
      viewBox={`0 0 ${width} ${GRAPH_ROW_HEIGHT}`}
    >
      {props.connectAbove ? (
        <path
          d={`M${laneX(row.lane)} 0 V${MID_Y}`}
          fill="none"
          strokeWidth={GRAPH_STROKE_WIDTH}
          className="stroke-muted-foreground"
        />
      ) : null}
      {row.segments.map((segment) => (
        <path
          // A lane holds one line at a time, so kind plus its lanes names a segment.
          key={`${segment.kind}:${segment.fromLane}:${segment.toLane}`}
          d={segmentPath(segment, row.lane)}
          fill="none"
          strokeWidth={GRAPH_STROKE_WIDTH}
          className={laneStrokeClass(segment.color)}
        />
      ))}
      <circle
        cx={laneX(row.lane)}
        cy={MID_Y}
        r={GRAPH_NODE_RADIUS}
        strokeWidth={hollow ? GRAPH_STROKE_WIDTH : 0}
        className={
          hollow ? cn("fill-background", laneStrokeClass(row.color)) : laneFillClass(row.color)
        }
      />
    </svg>
  );
}

export function GitGraphRow(props: {
  readonly id: string;
  readonly commit: GitLogCommit;
  readonly row: GraphRow | undefined;
  readonly maxLanes: number;
  readonly labels: ReadonlyArray<GitRefLabel>;
  readonly isHead: boolean;
  /** HEAD sits right below the uncommitted changes row, which links down to it. */
  readonly connectAbove: boolean;
  readonly selected: boolean;
  readonly onSelect: (hash: string) => void;
  readonly onOpenMenu: GitOpenMenu;
}) {
  const { commit, row } = props;
  return (
    <div
      id={props.id}
      role="option"
      aria-selected={props.selected}
      className={cn(
        "flex h-6.5 cursor-default items-center gap-1.5 pr-2.5 text-xs whitespace-nowrap",
        props.selected && "bg-accent",
      )}
      onClick={() => props.onSelect(commit.hash)}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onOpenMenu(
          { kind: "commit", hash: commit.hash },
          { x: event.clientX, y: event.clientY },
        );
      }}
    >
      {row ? (
        <GraphCell
          row={row}
          maxLanes={props.maxLanes}
          hollow={props.isHead}
          connectAbove={props.connectAbove}
        />
      ) : null}
      <GitRefLabels labels={props.labels} hash={commit.hash} onOpenMenu={props.onOpenMenu} />
      <span className="min-w-0 flex-1 truncate text-foreground">{commit.subject}</span>
      <span className="w-18 shrink-0 truncate text-right text-muted-foreground">
        {commit.authorName}
      </span>
      <span className="w-18 shrink-0 truncate text-right text-muted-foreground">
        {formatRelativeTimeLabel(new Date(commit.authoredAt * 1000).toISOString())}
      </span>
      <span className="w-18 shrink-0 text-right font-mono text-muted-foreground">
        {commit.hash.slice(0, SHORT_HASH_LENGTH)}
      </span>
    </div>
  );
}

/** The uncommitted changes above HEAD; a hollow muted node on HEAD's lane. */
export function GitUncommittedRow(props: {
  readonly id: string;
  readonly fileCount: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly lane: number;
  readonly maxLanes: number;
  readonly connectBelow: boolean;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}) {
  const t = useT();
  const width = graphWidth(props.maxLanes);
  const x = laneX(props.lane);
  return (
    <div
      id={props.id}
      role="option"
      aria-selected={props.selected}
      className={cn(
        "flex h-6.5 cursor-default items-center gap-1.5 pr-2.5 text-xs whitespace-nowrap",
        props.selected && "bg-accent",
      )}
      onClick={() => props.onSelect(UNCOMMITTED_ROW_ID)}
    >
      <svg
        aria-hidden
        className="shrink-0"
        width={width}
        height={GRAPH_ROW_HEIGHT}
        viewBox={`0 0 ${width} ${GRAPH_ROW_HEIGHT}`}
      >
        {props.connectBelow ? (
          <path
            d={`M${x} ${MID_Y} V${GRAPH_ROW_HEIGHT}`}
            fill="none"
            strokeWidth={GRAPH_STROKE_WIDTH}
            className="stroke-muted-foreground"
          />
        ) : null}
        <circle
          cx={x}
          cy={MID_Y}
          r={GRAPH_NODE_RADIUS}
          strokeWidth={GRAPH_STROKE_WIDTH}
          className="fill-background stroke-muted-foreground"
        />
      </svg>
      <span className="min-w-0 flex-1 truncate text-muted-foreground italic">
        {t("git.workingTree.row", { count: props.fileCount })}
      </span>
      <span className="shrink-0 text-right text-muted-foreground">
        {`+${props.insertions} −${props.deletions}`}
      </span>
    </div>
  );
}
