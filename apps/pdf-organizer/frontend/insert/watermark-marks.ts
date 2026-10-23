import type { PlanPage } from '../document/page-plan';
import { turnPoint } from '../marks/mark';
import type { Mark, Point } from '../marks/mark';

/**
 * A watermark is a mark like any other (text or a picture), put on each page
 * at the same place: afterwards it can still be moved, resized and turned on
 * any page, with the drawing tools.
 */

/** Where on the page it goes: -1, 0 or 1 across (left, middle, right) and down (top, middle, bottom). */
export interface WatermarkPlace {
  readonly across: -1 | 0 | 1;
  readonly down: -1 | 0 | 1;
}

export const WATERMARK_PLACES: readonly WatermarkPlace[] = ([-1, 0, 1] as const).flatMap((down) => ([-1, 0, 1] as const).map((across) => ({ across, down })));

/** How it lies: straight, or slanted up or down to the right (degrees clockwise). */
export const WATERMARK_ANGLES = { straight: 0, rising: -45, falling: 45 } as const;
export type WatermarkAngle = keyof typeof WATERMARK_ANGLES;

export interface WatermarkOptions {
  readonly place: WatermarkPlace;
  readonly angle: WatermarkAngle;
  /** How much of the page's width it takes, from 0 to 1. */
  readonly share: number;
  readonly opacity: number;
}

/** Space kept between a watermark at an edge and that edge, as a share of the page's shorter side. */
const EDGE_MARGIN = 0.05;

/** The size of a plan page as the reader sees it (after the user's turn). */
function shownSize(page: PlanPage): { width: number; height: number } {
  return page.rotation % 180 === 0 ? { width: page.width, height: page.height } : { width: page.height, height: page.width };
}

/** A place on the page as shown, found in the page's own grid (before the user's turn). */
export function toPageGrid(shown: Point, page: PlanPage): Point {
  if (page.rotation === 90) return { x: shown.y, y: page.height - shown.x };
  if (page.rotation === 180) return { x: page.width - shown.x, y: page.height - shown.y };
  if (page.rotation === 270) return { x: page.width - shown.y, y: shown.x };
  return shown;
}

/**
 * The watermark on one page: `sample` (a text or picture mark of any size,
 * at any place) scaled, turned and put where the options say, as the reader
 * sees the page. `scaled` returns the sample at a new width (text changes
 * the size of its letters, a picture its box).
 */
export function watermarkOn(page: PlanPage, sample: Mark, options: WatermarkOptions, scaled: (mark: Mark, width: number) => Mark, id: string): Mark {
  const shown = shownSize(page);
  const degrees = WATERMARK_ANGLES[options.angle];
  const radians = (Math.abs(degrees) * Math.PI) / 180;
  // The room it takes across, once turned, is the share asked for.
  const ratio = sample.width > 0 ? sample.height / sample.width : 1;
  const wanted = shown.width * Math.min(Math.max(options.share, 0.02), 1);
  const width = wanted / (Math.cos(radians) + ratio * Math.sin(radians));
  const sized = scaled(sample, width);
  const across = sized.width * Math.cos(radians) + sized.height * Math.sin(radians);
  const down = sized.width * Math.sin(radians) + sized.height * Math.cos(radians);

  const margin = Math.min(shown.width, shown.height) * EDGE_MARGIN;
  const along = (side: number, room: number, where: -1 | 0 | 1) => (where === 0 ? side / 2 : where === -1 ? margin + room / 2 : side - margin - room / 2);
  const middleShown = { x: along(shown.width, across, options.place.across), y: along(shown.height, down, options.place.down) };
  const middle = toPageGrid(middleShown, page);
  return {
    ...sized,
    id,
    x: middle.x - sized.width / 2,
    y: middle.y - sized.height / 2,
    // The page's own turn is taken back out: the watermark lies as asked for the reader.
    rotation: (((degrees - page.rotation) % 360) + 360) % 360,
    opacity: options.opacity,
  };
}

/** Where the corners of a mark end up, as the reader sees the page; for tests and for keeping it on the page. */
export function shownCorners(mark: Mark, page: PlanPage): Point[] {
  const center = { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 };
  const corners = [
    { x: mark.x, y: mark.y },
    { x: mark.x + mark.width, y: mark.y },
    { x: mark.x + mark.width, y: mark.y + mark.height },
    { x: mark.x, y: mark.y + mark.height },
  ].map((corner) => turnPoint(corner, center, mark.rotation));
  return corners.map((corner) => {
    if (page.rotation === 90) return { x: page.height - corner.y, y: corner.x };
    if (page.rotation === 180) return { x: page.width - corner.x, y: page.height - corner.y };
    if (page.rotation === 270) return { x: corner.y, y: page.width - corner.x };
    return corner;
  });
}
