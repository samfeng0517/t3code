import { GRAPH_COLOR_COUNT } from "./gitGraphLayout";

/** Matches the row's `h-6.5`; the list needs it as a size estimate. */
export const GRAPH_ROW_HEIGHT = 26;
export const GRAPH_LANE_WIDTH = 12;
export const GRAPH_NODE_RADIUS = 3.5;
export const GRAPH_STROKE_WIDTH = 1.5;

// Literal class names so Tailwind finds them; index = the layout's `color`.
const LANE_STROKE_CLASSES = [
  "stroke-blue-500",
  "stroke-emerald-500",
  "stroke-pink-500",
  "stroke-amber-500",
  "stroke-violet-500",
  "stroke-cyan-500",
  "stroke-orange-500",
  "stroke-lime-600",
] as const;

const LANE_FILL_CLASSES = [
  "fill-blue-500",
  "fill-emerald-500",
  "fill-pink-500",
  "fill-amber-500",
  "fill-violet-500",
  "fill-cyan-500",
  "fill-orange-500",
  "fill-lime-600",
] as const;

export const laneStrokeClass = (color: number): string =>
  LANE_STROKE_CLASSES[color % GRAPH_COLOR_COUNT] ?? LANE_STROKE_CLASSES[0];

export const laneFillClass = (color: number): string =>
  LANE_FILL_CLASSES[color % GRAPH_COLOR_COUNT] ?? LANE_FILL_CLASSES[0];

/** Horizontal center of a lane in SVG units. */
export const laneX = (lane: number): number => lane * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2;
