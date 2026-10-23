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
 * shown at `zoom` is sharp on a screen with this pixel density.
 */
export function renderScale(zoom: number, devicePixelRatio: number): number {
  const scale = zoom * PIXELS_PER_POINT * Math.max(devicePixelRatio, 1);
  return Math.round(Math.min(scale, MAX_RENDER_SCALE) * 100) / 100;
}
