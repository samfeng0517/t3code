export const GRAPH_COLOR_COUNT = 8;

export interface GraphSegment {
  /** `top`: row top at `fromLane` to the node; `bottom`: node to row bottom at `toLane`; `through`: straight line in one lane. */
  readonly kind: "top" | "bottom" | "through";
  readonly fromLane: number;
  readonly toLane: number;
  readonly color: number;
}

export interface GraphRow {
  readonly lane: number;
  readonly color: number;
  readonly segments: ReadonlyArray<GraphSegment>;
}

export interface GraphLayout {
  readonly rows: ReadonlyArray<GraphRow>;
  readonly maxLanes: number;
}

interface GraphCommit {
  readonly hash: string;
  readonly parents: ReadonlyArray<string>;
}

interface LaneSlot {
  readonly hash: string;
  readonly color: number;
}

/**
 * Lays out a topo-ordered (newest first) commit list into lanes. Lanes never shift index, so a
 * line keeps its column for its whole length and rows can be drawn independently.
 */
export function computeGraphLayout(commits: ReadonlyArray<GraphCommit>): GraphLayout {
  const active: Array<LaneSlot | null> = [];
  const rows: GraphRow[] = [];
  let lineCounter = 0;
  let maxLanes = 0;

  const nextColor = () => {
    const color = lineCounter % GRAPH_COLOR_COUNT;
    lineCounter += 1;
    return color;
  };
  const lowestFreeLane = () => {
    const free = active.indexOf(null);
    return free === -1 ? active.length : free;
  };

  for (const { hash, parents } of commits) {
    const segments: GraphSegment[] = [];
    const expectingLane = active.findIndex((slot) => slot?.hash === hash);
    const expectingSlot = expectingLane === -1 ? undefined : active[expectingLane];
    const lane = expectingSlot ? expectingLane : lowestFreeLane();
    const color = expectingSlot ? expectingSlot.color : nextColor();

    let rowWidth = lane + 1;
    for (let index = 0; index < active.length; index += 1) {
      const slot = active[index];
      if (!slot) continue;
      if (slot.hash === hash) {
        segments.push({ kind: "top", fromLane: index, toLane: lane, color: slot.color });
        active[index] = null;
      } else {
        segments.push({ kind: "through", fromLane: index, toLane: index, color: slot.color });
      }
      rowWidth = Math.max(rowWidth, index + 1);
    }

    const [firstParent, ...mergedParents] = parents;
    if (firstParent === undefined) {
      active[lane] = null;
    } else {
      active[lane] = { hash: firstParent, color };
      segments.push({ kind: "bottom", fromLane: lane, toLane: lane, color });
      for (const parent of mergedParents) {
        const existingLane = active.findIndex((slot) => slot?.hash === parent);
        const target = existingLane === -1 ? lowestFreeLane() : existingLane;
        const slot = active[target] ?? { hash: parent, color: nextColor() };
        active[target] = slot;
        segments.push({ kind: "bottom", fromLane: lane, toLane: target, color: slot.color });
        rowWidth = Math.max(rowWidth, target + 1);
      }
    }

    while (active.length > 0 && active[active.length - 1] === null) active.pop();
    maxLanes = Math.max(maxLanes, rowWidth);
    rows.push({ lane, color, segments });
  }

  return { rows, maxLanes };
}
