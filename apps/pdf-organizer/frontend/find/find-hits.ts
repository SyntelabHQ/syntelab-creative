import type { PlanPage, QuarterTurns } from '../document/page-plan';

/** A rectangle on a page, in PDF points from the page's top-left corner. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One place where the text was found. */
export interface Hit extends Box {
  /** Index of the page in the page plan (the document as arranged now). */
  readonly page: number;
}

/** What `search_text` answers for one page of a file. */
export interface FoundPage {
  readonly page: number;
  /** `[x0, y0, width0, height0, …]`. */
  readonly boxes: readonly number[];
}

/**
 * Where each page of each open file sits in the plan: `documentId` → page in
 * the file → indexes in the plan. A page the user removed is not in it.
 */
export function planPlaces(plan: readonly PlanPage[]): Map<number, Map<number, number[]>> {
  const places = new Map<number, Map<number, number[]>>();
  plan.forEach((page, index) => {
    const ofDocument = places.get(page.documentId) ?? new Map<number, number[]>();
    places.set(page.documentId, ofDocument);
    ofDocument.set(page.page, [...(ofDocument.get(page.page) ?? []), index]);
  });
  return places;
}

/** Turns what was found in one file into hits on the pages of the plan. */
export function hitsOnPlan(found: readonly FoundPage[], placesOfDocument: ReadonlyMap<number, readonly number[]>): Hit[] {
  const hits: Hit[] = [];
  for (const { page, boxes } of found) {
    for (const planIndex of placesOfDocument.get(page) ?? []) {
      for (let at = 0; at + 3 < boxes.length; at += 4) {
        hits.push({ page: planIndex, x: boxes[at] ?? 0, y: boxes[at + 1] ?? 0, width: boxes[at + 2] ?? 0, height: boxes[at + 3] ?? 0 });
      }
    }
  }
  return hits;
}

/** Reading order: page by page, top to bottom, then left to right. */
export function compareHits(a: Hit, b: Hit): number {
  return a.page - b.page || a.y - b.y || a.x - b.x;
}

/**
 * The same rectangle after the page is turned clockwise. `width` and
 * `height` are the page's size before the turn.
 */
export function turnBox(box: Box, width: number, height: number, turn: QuarterTurns): Box {
  switch (turn) {
    case 90:
      return { x: height - box.y - box.height, y: box.x, width: box.height, height: box.width };
    case 180:
      return { x: width - box.x - box.width, y: height - box.y - box.height, width: box.width, height: box.height };
    case 270:
      return { x: box.y, y: width - box.x - box.width, width: box.height, height: box.width };
    default:
      return box;
  }
}

/** The hit to go to from `active` (-1: none yet), wrapping around at the ends. */
export function stepHit(hits: readonly Hit[], active: number, direction: 1 | -1, currentPage: number): number {
  if (hits.length === 0) return -1;
  if (active < 0) {
    // The first step lands on the page in view, or the nearest one after it (before it, going back).
    const ahead = hits.findIndex((hit) => hit.page >= currentPage);
    if (direction === 1) return ahead < 0 ? 0 : ahead;
    // Hits are in reading order: the last one at or before the page in view sits just before `ahead`'s later pages.
    let behind = hits.length - 1;
    while (behind >= 0 && (hits[behind]?.page ?? 0) > currentPage) behind -= 1;
    return behind < 0 ? hits.length - 1 : behind;
  }
  return (active + direction + hits.length) % hits.length;
}
