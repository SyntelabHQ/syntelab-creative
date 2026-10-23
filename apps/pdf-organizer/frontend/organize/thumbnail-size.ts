/**
 * How large pages are shown in the Organize grid and on the cards of a
 * binder: the longest side of a page's picture, in CSS pixels. The size goes
 * in steps, so a picture is only drawn again at a few sizes.
 */

export const MIN_THUMBNAIL_SIZE = 64;
export const MAX_THUMBNAIL_SIZE = 320;
export const THUMBNAIL_SIZE_STEP = 16;

/** The Organize grid starts as it always was. */
export const DEFAULT_ORGANIZE_THUMBNAIL_SIZE = 128;
/** The cards of a binder start smaller than they once were (a page 170 pixels tall). */
export const DEFAULT_BINDER_THUMBNAIL_SIZE = 112;

/** Width of the stored thumbnails the Rust side draws (`THUMBNAIL_WIDTH` in render/thumbnails.rs). */
const STORED_THUMBNAIL_WIDTH = 240;
/** A stored thumbnail is stretched this much at most before a sharper picture is asked for. */
const STRETCH_ALLOWED = 1.2;
/** Sharper pictures are asked for in widths of this many pixels, so near sizes share one. */
const RENDER_WIDTH_STEP = 64;

/** Wheel movement that makes one step: one notch of a mouse wheel. */
export const WHEEL_UNITS_PER_STEP = 100;

/** A size kept within the range and on a step; anything that is not a number gives `fallback`. */
export function snapThumbnailSize(size: unknown, fallback: number): number {
  if (typeof size !== 'number' || !Number.isFinite(size)) return fallback;
  const stepped = MIN_THUMBNAIL_SIZE + Math.round((size - MIN_THUMBNAIL_SIZE) / THUMBNAIL_SIZE_STEP) * THUMBNAIL_SIZE_STEP;
  return Math.min(Math.max(stepped, MIN_THUMBNAIL_SIZE), MAX_THUMBNAIL_SIZE);
}

/** The size `steps` steps larger (or smaller, when negative), within the range. */
export function stepThumbnailSize(size: number, steps: number): number {
  return snapThumbnailSize(size + steps * THUMBNAIL_SIZE_STEP, size);
}

/** Wheel movement gathered so far that has not made a whole step yet. */
export interface WheelSteps {
  /** Whole steps to take now: positive is larger. */
  readonly steps: number;
  readonly rest: number;
}

/**
 * Ctrl + wheel: wheel movement (`deltaY`, in pixels; down is positive) turned
 * into steps of size. A mouse wheel moves a step a notch; the small movements
 * of a touchpad add up until they make one. Turning back starts again.
 */
export function wheelSteps(rest: number, deltaY: number): WheelSteps {
  // `rest` counts the other way from `deltaY`: up (negative) makes it larger.
  const turnedBack = rest !== 0 && Math.sign(rest) === Math.sign(deltaY);
  const total = (turnedBack ? 0 : rest) - deltaY;
  const steps = Math.trunc(total / WHEEL_UNITS_PER_STEP) || 0;
  return { steps, rest: total - steps * WHEEL_UNITS_PER_STEP };
}

/**
 * The scale to draw a page at (1 = 72 pixels per inch) when it is shown with
 * its longest side `size` CSS pixels on a screen of this pixel density; null
 * when the stored thumbnail is sharp enough. `width` and `height` are the
 * page's size in points, upright.
 */
export function sharpScale(size: number, width: number, height: number, devicePixelRatio: number): number | null {
  const longest = Math.max(width, height, 1);
  const shownWidth = (size * Math.max(width, 1)) / longest;
  const pixels = shownWidth * Math.max(devicePixelRatio, 1);
  if (pixels <= STORED_THUMBNAIL_WIDTH * STRETCH_ALLOWED) return null;
  const wanted = Math.ceil(pixels / RENDER_WIDTH_STEP) * RENDER_WIDTH_STEP;
  return Math.round((wanted / Math.max(width, 1)) * 100) / 100;
}
