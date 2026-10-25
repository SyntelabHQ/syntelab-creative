/** Zoom levels the buttons step through, and the list offers. 1 = real size (100%). */
export const ZOOM_STEPS = [
  0.01, 0.065, 0.125, 0.25, 0.333, 0.5, 0.667, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 64,
] as const;

/** CSS pixels per PDF point at 100% (96 pixels per inch / 72 points per inch). */
export const PIXELS_PER_POINT = 96 / 72;

/** Sharper pictures than this are never requested, whatever the zoom and screen. */
const MAX_RENDER_SCALE = 8;

export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? zoom;
}

export function zoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001) ?? zoom;
}

/**
 * Reads a zoom typed by the user: `150`, `150%`, `66,7 %`. Returns the zoom
 * (1 = 100%) kept within what the viewer can show, or null when it is not a number.
 */
export function parseZoom(text: string, min: number, max: number): number | null {
  const percent = Number.parseFloat(text.replace(',', '.').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(percent) || percent <= 0) return null;
  return Math.min(Math.max(percent / 100, min), max);
}

/**
 * The scale to ask the Rust side for (1 = 72 pixels per inch), so a page
 * shown at `zoom` is sharp on a screen with this pixel density. Not rounded:
 * the Rust side draws the page on its width and height times this, rounded,
 * which is then exactly the size `onWholePixels` gives the page on screen,
 * so the picture is shown pixel for pixel, not stretched.
 */
export function renderScale(zoom: number, devicePixelRatio: number): number {
  return Math.min(zoom * PIXELS_PER_POINT * Math.max(devicePixelRatio, 1), MAX_RENDER_SCALE);
}

/**
 * A length in CSS pixels made a whole number of the screen's own pixels: a
 * page whose edges fall between pixels has its picture stretched by a pixel,
 * which softens every letter on it.
 */
export function onWholePixels(cssPixels: number, devicePixelRatio: number): number {
  const ratio = Math.max(devicePixelRatio, 1);
  return Math.round(cssPixels * ratio) / ratio;
}

/** Pages larger than this on screen, in the screen's own pixels, are drawn in pieces: only those in view. */
const TILED_ABOVE_PIXELS = 4_000_000;
/** The side of one piece, in the screen's own pixels. */
export const TILE_SIDE = 512;
/** Pieces are drawn up to this sharp (1 = 72 pixels per inch), as the Rust side allows. */
const MAX_TILE_SCALE = 128;
/**
 * Under its pieces a page is also drawn whole, to show until the pieces come: as sharp as a page not in pieces
 * may be, so going from one to the other never blurs the page for a moment.
 */
const BASE_PIXELS = TILED_ABOVE_PIXELS;

/** A rectangle of a page's picture, in its pixels from the top-left corner. */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The scale that draws a page at `zoom` pixel for pixel on this screen, with no upper limit but the pieces'. */
export function screenScale(zoom: number, devicePixelRatio: number): number {
  return Math.min(zoom * PIXELS_PER_POINT * Math.max(devicePixelRatio, 1), MAX_TILE_SCALE);
}

/** The size of a page's picture at `scale`, as the Rust side draws it (each side rounded to whole pixels). */
export function picturePixels(widthPoints: number, heightPoints: number, scale: number): { width: number; height: number } {
  return { width: Math.max(Math.round(widthPoints * scale), 1), height: Math.max(Math.round(heightPoints * scale), 1) };
}

/** True when a picture this big is drawn in pieces. */
export function isTiled(picture: { width: number; height: number }): boolean {
  return picture.width * picture.height > TILED_ABOVE_PIXELS;
}

/** The scale of the whole page drawn under its pieces: as sharp as asked, but never bigger than `BASE_PIXELS`. */
export function baseScale(widthPoints: number, heightPoints: number, scale: number): number {
  const area = widthPoints * heightPoints;
  return area > 0 ? Math.min(scale, Math.sqrt(BASE_PIXELS / area)) : scale;
}

/**
 * The pieces of a picture `width` × `height` to draw for the part of it in view (`seen`, in its pixels), with
 * one more piece all around, so a short scroll finds them ready. None when the picture is farther away than that.
 */
export function tilesInView(
  picture: { width: number; height: number },
  seen: { left: number; top: number; right: number; bottom: number },
  side = TILE_SIDE,
): TileRect[] {
  const [left, top] = [Math.max(seen.left - side, 0), Math.max(seen.top - side, 0)];
  const [right, bottom] = [Math.min(seen.right + side, picture.width), Math.min(seen.bottom + side, picture.height)];
  if (right <= left || bottom <= top) return [];
  const tiles: TileRect[] = [];
  for (let y = Math.floor(top / side) * side; y < bottom; y += side) {
    for (let x = Math.floor(left / side) * side; x < right; x += side) {
      tiles.push({ x, y, width: Math.min(side, picture.width - x), height: Math.min(side, picture.height - y) });
    }
  }
  return tiles;
}
