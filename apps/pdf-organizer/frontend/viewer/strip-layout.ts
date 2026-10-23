/**
 * A vertical strip of items of different heights (pages, thumbnails), and the
 * arithmetic for showing only the part of it that is on screen.
 */
export interface StripLayout {
  /** Distance from the top of the strip to the top of each item. */
  readonly tops: Float64Array;
  readonly heights: Float64Array;
  readonly totalHeight: number;
}

export interface ItemRange {
  /** First item, inclusive. */
  readonly first: number;
  /** Last item, inclusive. Smaller than `first` when the range is empty. */
  readonly last: number;
}

export const EMPTY_RANGE: ItemRange = { first: 0, last: -1 };

/** Stacks the items with `gap` between them and `padding` above and below. */
export function layoutStrip(heights: ArrayLike<number>, gap: number, padding: number): StripLayout {
  const tops = new Float64Array(heights.length);
  let top = padding;
  for (let index = 0; index < heights.length; index++) {
    tops[index] = top;
    top += (heights[index] ?? 0) + gap;
  }
  const totalHeight = heights.length === 0 ? padding * 2 : top - gap + padding;
  return { tops, heights: Float64Array.from(heights), totalHeight };
}

/** The item at distance `y` from the top (the nearest one when `y` is in a gap). */
export function itemAt(layout: StripLayout, y: number): number {
  let low = 0;
  let high = layout.tops.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((layout.tops[middle] ?? 0) <= y) low = middle;
    else high = middle - 1;
  }
  return Math.max(low, 0);
}

/** The items that touch the window `[top, top + height]`, widened by `overscan` on both sides. */
export function itemsInWindow(layout: StripLayout, top: number, height: number, overscan: number): ItemRange {
  const count = layout.tops.length;
  if (count === 0 || height <= 0) return EMPTY_RANGE;
  const first = itemAt(layout, top - overscan);
  const last = itemAt(layout, top + height + overscan);
  return { first, last: Math.min(last, count - 1) };
}

export function rangesEqual(a: ItemRange, b: ItemRange): boolean {
  return a.first === b.first && a.last === b.last;
}
