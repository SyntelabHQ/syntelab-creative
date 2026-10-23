import type { QuarterTurns } from '../document/page-plan';

/** How much is cut off each edge of a page as shown, in PDF points. */
export interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export const NO_EDGES: Edges = { left: 0, top: 0, right: 0, bottom: 0 };
export const EDGE_NAMES = ['top', 'bottom', 'left', 'right'] as const;
export type EdgeName = (typeof EDGE_NAMES)[number];

/** The units margins can be typed in, each with how many points it is and how many decimals are worth showing. */
export const UNITS = {
  mm: { points: 72 / 25.4, decimals: 1 },
  in: { points: 72, decimals: 3 },
  pt: { points: 1, decimals: 0 },
} as const;
export type Unit = keyof typeof UNITS;
export const UNIT_NAMES = Object.keys(UNITS) as Unit[];

export function toUnit(points: number, unit: Unit): number {
  const factor = 10 ** UNITS[unit].decimals;
  return Math.round((points / UNITS[unit].points) * factor) / factor;
}

export function fromUnit(value: number, unit: Unit): number {
  return (Number.isFinite(value) ? Math.max(value, 0) : 0) * UNITS[unit].points;
}

/** The least that must be left of a page, in points. */
const SMALLEST_SIDE = 8;

/** The edges kept within what a page of `width` × `height` allows: something of it is always left. */
export function clampEdges(edges: Edges, width: number, height: number): Edges {
  const left = Math.min(Math.max(edges.left, 0), width - SMALLEST_SIDE);
  const top = Math.min(Math.max(edges.top, 0), height - SMALLEST_SIDE);
  return {
    left,
    top,
    right: Math.min(Math.max(edges.right, 0), width - SMALLEST_SIDE - left),
    bottom: Math.min(Math.max(edges.bottom, 0), height - SMALLEST_SIDE - top),
  };
}

/** The frame that is kept, in points from the page's top-left corner. */
export function frameOf(edges: Edges, width: number, height: number): { x: number; y: number; width: number; height: number } {
  return { x: edges.left, y: edges.top, width: width - edges.left - edges.right, height: height - edges.top - edges.bottom };
}

/** The edges that leave the frame between two corners drawn on the page. */
export function edgesOfFrame(from: { x: number; y: number }, to: { x: number; y: number }, width: number, height: number): Edges {
  return clampEdges(
    { left: Math.min(from.x, to.x), top: Math.min(from.y, to.y), right: width - Math.max(from.x, to.x), bottom: height - Math.max(from.y, to.y) },
    width,
    height,
  );
}

/** The handles of the frame: which edges each one moves. */
export const FRAME_HANDLES = {
  nw: ['left', 'top'],
  n: ['top'],
  ne: ['right', 'top'],
  e: ['right'],
  se: ['right', 'bottom'],
  s: ['bottom'],
  sw: ['left', 'bottom'],
  w: ['left'],
} as const satisfies Record<string, readonly EdgeName[]>;
export type FrameHandle = keyof typeof FRAME_HANDLES;

/** The edges after a handle of the frame was dragged to `point`. */
export function dragHandle(edges: Edges, handle: FrameHandle, point: { x: number; y: number }, width: number, height: number): Edges {
  const next = { ...edges };
  for (const edge of FRAME_HANDLES[handle]) {
    if (edge === 'left') next.left = Math.min(point.x, width - edges.right - SMALLEST_SIDE);
    if (edge === 'right') next.right = Math.min(width - point.x, width - edges.left - SMALLEST_SIDE);
    if (edge === 'top') next.top = Math.min(point.y, height - edges.bottom - SMALLEST_SIDE);
    if (edge === 'bottom') next.bottom = Math.min(height - point.y, height - edges.top - SMALLEST_SIDE);
  }
  return clampEdges(next, width, height);
}

/** The frame moved as a whole, without changing its size, kept on the page. */
export function moveFrame(edges: Edges, dx: number, dy: number): Edges {
  const x = Math.min(Math.max(dx, -edges.left), edges.right);
  const y = Math.min(Math.max(dy, -edges.top), edges.bottom);
  return { left: edges.left + x, right: edges.right - x, top: edges.top + y, bottom: edges.bottom - y };
}

/**
 * Edges measured on a page as it lies in its file (`[left, top, right,
 * bottom]`), as edges of the page the way the reader sees it after the
 * user's turn.
 */
export function shownEdges(own: readonly [number, number, number, number], turn: QuarterTurns): Edges {
  const [left, top, right, bottom] = own;
  if (turn === 90) return { top: left, right: top, bottom: right, left: bottom };
  if (turn === 180) return { right: left, bottom: top, left: right, top: bottom };
  if (turn === 270) return { bottom: left, left: top, top: right, right: bottom };
  return { left, top, right, bottom };
}

