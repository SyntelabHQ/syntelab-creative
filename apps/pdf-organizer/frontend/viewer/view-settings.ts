import { PIXELS_PER_POINT } from './zoom';

/** How the zoom is chosen: by hand, or so that pages fit the window. */
export type ZoomMode = 'custom' | 'actual' | 'fit-page' | 'fit-width' | 'fit-height';

export type PageLayout = 'single' | 'two-page';

/** Degrees the pages are turned clockwise, for viewing only. */
export type ViewRotation = 0 | 90 | 180 | 270;

/** A quarter turn further clockwise. */
export function rotateClockwise(rotation: ViewRotation): ViewRotation {
  return ((rotation + 90) % 360) as ViewRotation;
}

/** The choices in the viewer's "View options" menu, for one open document. */
export interface ViewSettings {
  readonly zoomMode: ZoomMode;
  /** The zoom when `zoomMode` is `custom`. 1 = real size. */
  readonly customZoom: number;
  readonly pageLayout: PageLayout;
  /** With two pages side by side: the first page stands alone, like a book cover. */
  readonly coverPage: boolean;
  /**
   * True: all pages in one long strip. False (the default): one page (or
   * pair) at a time, and the mouse wheel moves from one to the next.
   */
  readonly scrolling: boolean;
  /** The file itself is not changed. */
  readonly rotation: ViewRotation;
  /** Rulers along the top and the left of the pages. */
  readonly rulers: boolean;
  /** A grid of lines over the pages, to line things up by. Never printed or saved. */
  readonly grid: boolean;
}

// One whole page at a time: each step of the mouse wheel shows the next page.
export const DEFAULT_VIEW: ViewSettings = {
  zoomMode: 'fit-page',
  customZoom: 1,
  pageLayout: 'single',
  coverPage: false,
  scrolling: false,
  rotation: 0,
  rulers: false,
  grid: false,
};

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 64;

export interface FitInput {
  /** Space for pages, in CSS pixels (the window minus its padding). */
  readonly availableWidth: number;
  readonly availableHeight: number;
  /** The widest row and the tallest row to fit, in PDF points. */
  readonly widestRowPoints: number;
  readonly tallestRowPoints: number;
  /** Pixels between two pages of a row that do not scale with the zoom. */
  readonly fixedRowGap: number;
}

/**
 * The zoom the settings ask for. The caller chooses which rows a fit mode
 * measures: the one on screen, or all of them when they scroll past.
 */
export function resolveZoom(settings: ViewSettings, fit: FitInput): number {
  const clamp = (zoom: number) => Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
  if (settings.zoomMode === 'custom') return clamp(settings.customZoom);
  if (settings.zoomMode === 'actual') return 1;

  const byWidth = (fit.availableWidth - fit.fixedRowGap) / (fit.widestRowPoints * PIXELS_PER_POINT);
  const byHeight = fit.availableHeight / (fit.tallestRowPoints * PIXELS_PER_POINT);
  const zoom =
    settings.zoomMode === 'fit-width' ? byWidth : settings.zoomMode === 'fit-height' ? byHeight : Math.min(byWidth, byHeight);
  // Not measured yet, or an empty document: stay at real size.
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  // Rounded down a little, so rounding never makes a scroll bar appear.
  return clamp(Math.floor(zoom * 1000) / 1000);
}
