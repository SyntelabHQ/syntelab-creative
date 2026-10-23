import type { PlanPage } from '../document/page-plan';
import { shownCorners, toPageGrid } from '../insert/watermark-marks';
import { moveMark } from './mark';
import type { Mark } from './mark';

/** Where on the page, one way: at its start (left, top), in its middle, at its end (right, bottom). */
export type Along = -1 | 0 | 1;

/**
 * The mark moved against an edge of its page, or to its middle, as the reader
 * sees the page: `across` and `down` each say where, or null to stay as it is
 * that way. What counts is the room the mark takes once turned.
 */
export function placedOnPage(mark: Mark, page: PlanPage, across: Along | null, down: Along | null): Mark {
  const corners = shownCorners(mark, page);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const sideways = page.rotation % 180 !== 0;
  const [shownWidth, shownHeight] = sideways ? [page.height, page.width] : [page.width, page.height];
  const shift = (where: Along | null, low: number, high: number, side: number) =>
    where === null ? 0 : where === -1 ? -low : where === 1 ? side - high : (side - low - high) / 2;
  const shown = { x: shift(across, Math.min(...xs), Math.max(...xs), shownWidth), y: shift(down, Math.min(...ys), Math.max(...ys), shownHeight) };
  // The same step in the page's own grid, which may lie turned under what is shown.
  const [to, from] = [toPageGrid(shown, page), toPageGrid({ x: 0, y: 0 }, page)];
  return moveMark(mark, to.x - from.x, to.y - from.y);
}
