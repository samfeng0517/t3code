import { describe, expect, it } from "vite-plus/test";

import { computeGraphLayout, GRAPH_COLOR_COUNT } from "./gitGraphLayout";

const commit = (hash: string, ...parents: string[]) => ({ hash, parents });

describe("computeGraphLayout", () => {
  it("computeGraphLayout should keep a linear history in lane 0 when every commit has one parent", () => {
    const layout = computeGraphLayout([commit("c", "b"), commit("b", "a"), commit("a")]);

    expect(layout.maxLanes).toBe(1);
    expect(layout.rows).toEqual([
      { lane: 0, color: 0, segments: [{ kind: "bottom", fromLane: 0, toLane: 0, color: 0 }] },
      {
        lane: 0,
        color: 0,
        segments: [
          { kind: "top", fromLane: 0, toLane: 0, color: 0 },
          { kind: "bottom", fromLane: 0, toLane: 0, color: 0 },
        ],
      },
      { lane: 0, color: 0, segments: [{ kind: "top", fromLane: 0, toLane: 0, color: 0 }] },
    ]);
  });

  it("computeGraphLayout should open a second lane for the merged parent when a commit has two parents", () => {
    const layout = computeGraphLayout([
      commit("m", "a", "b"),
      commit("a", "c"),
      commit("b", "c"),
      commit("c"),
    ]);

    expect(layout.maxLanes).toBe(2);
    expect(layout.rows[0]).toEqual({
      lane: 0,
      color: 0,
      segments: [
        { kind: "bottom", fromLane: 0, toLane: 0, color: 0 },
        { kind: "bottom", fromLane: 0, toLane: 1, color: 1 },
      ],
    });
    expect(layout.rows[1]).toEqual({
      lane: 0,
      color: 0,
      segments: [
        { kind: "top", fromLane: 0, toLane: 0, color: 0 },
        { kind: "through", fromLane: 1, toLane: 1, color: 1 },
        { kind: "bottom", fromLane: 0, toLane: 0, color: 0 },
      ],
    });
    expect(layout.rows[2]).toEqual({
      lane: 1,
      color: 1,
      segments: [
        { kind: "through", fromLane: 0, toLane: 0, color: 0 },
        { kind: "top", fromLane: 1, toLane: 1, color: 1 },
        { kind: "bottom", fromLane: 1, toLane: 1, color: 1 },
      ],
    });
  });

  it("computeGraphLayout should draw top segments from both lanes into the node when two lanes expect the same commit", () => {
    const layout = computeGraphLayout([
      commit("m", "a", "b"),
      commit("a", "c"),
      commit("b", "c"),
      commit("c", "d"),
      commit("d"),
    ]);

    expect(layout.rows[3]).toEqual({
      lane: 0,
      color: 0,
      segments: [
        { kind: "top", fromLane: 0, toLane: 0, color: 0 },
        { kind: "top", fromLane: 1, toLane: 0, color: 1 },
        { kind: "bottom", fromLane: 0, toLane: 0, color: 0 },
      ],
    });
    // The merged lane is freed, so the next row only uses lane 0.
    expect(layout.rows[4]).toEqual({
      lane: 0,
      color: 0,
      segments: [{ kind: "top", fromLane: 0, toLane: 0, color: 0 }],
    });
  });

  it("computeGraphLayout should reuse the lowest free lane when a branch ends at a root commit", () => {
    const layout = computeGraphLayout([
      commit("m", "a", "b", "c"),
      commit("b"),
      commit("a", "d", "e"),
      commit("e", "d"),
      commit("c", "d"),
      commit("d"),
    ]);

    expect(layout.rows[1]).toEqual({
      lane: 1,
      color: 1,
      segments: [
        { kind: "through", fromLane: 0, toLane: 0, color: 0 },
        { kind: "top", fromLane: 1, toLane: 1, color: 1 },
        { kind: "through", fromLane: 2, toLane: 2, color: 2 },
      ],
    });
    expect(layout.rows[2]).toEqual({
      lane: 0,
      color: 0,
      segments: [
        { kind: "top", fromLane: 0, toLane: 0, color: 0 },
        { kind: "through", fromLane: 2, toLane: 2, color: 2 },
        { kind: "bottom", fromLane: 0, toLane: 0, color: 0 },
        { kind: "bottom", fromLane: 0, toLane: 1, color: 3 },
      ],
    });
    expect(layout.rows[3]?.lane).toBe(1);
    expect(layout.maxLanes).toBe(3);
  });

  it("computeGraphLayout should keep a lane open to the last row when a parent is not loaded", () => {
    const layout = computeGraphLayout([commit("m", "a", "x"), commit("a", "b"), commit("b")]);

    expect(layout.maxLanes).toBe(2);
    expect(layout.rows[2]).toEqual({
      lane: 0,
      color: 0,
      segments: [
        { kind: "top", fromLane: 0, toLane: 0, color: 0 },
        { kind: "through", fromLane: 1, toLane: 1, color: 1 },
      ],
    });
  });

  it("computeGraphLayout should give each new line the next color modulo GRAPH_COLOR_COUNT", () => {
    const parents = Array.from({ length: GRAPH_COLOR_COUNT + 1 }, (_, index) => `p${index}`);
    const layout = computeGraphLayout([commit("octopus", ...parents)]);

    expect(layout.rows[0]?.segments.map((segment) => [segment.toLane, segment.color])).toEqual(
      parents.map((_, index) => [index, index % GRAPH_COLOR_COUNT]),
    );
    expect(layout.maxLanes).toBe(GRAPH_COLOR_COUNT + 1);
  });

  it("computeGraphLayout should produce one row per commit when given 5,000 commits with merges", () => {
    const commits: Array<{ hash: string; parents: string[] }> = [];
    for (let index = 0; commits.length < 5_000; index += 1) {
      if (index % 10 === 0) {
        commits.push(commit(`m${index}`, `m${index + 1}`, `s${index}-0`));
        commits.push(commit(`s${index}-0`, `s${index}-1`));
        commits.push(commit(`s${index}-1`, `m${index + 5}`));
      } else {
        commits.push(commit(`m${index}`, `m${index + 1}`));
      }
    }

    const layout = computeGraphLayout(commits);

    expect(layout.rows).toHaveLength(commits.length);
    expect(layout.maxLanes).toBe(2);
  });
});
