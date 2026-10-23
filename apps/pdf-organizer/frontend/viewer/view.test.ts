import { describe, expect, it } from 'vitest';
import { buildRows, measureRows, rowOfPage } from './page-rows';
import { DEFAULT_VIEW, resolveZoom, rotateClockwise } from './view-settings';
import type { FitInput } from './view-settings';
import { PIXELS_PER_POINT } from './zoom';

describe('buildRows', () => {
  it('puts one page per row in single-page view', () => {
    expect(buildRows(3, 'single', false)).toEqual([[0], [1], [2]]);
  });

  it('pairs pages in two-page view', () => {
    expect(buildRows(5, 'two-page', false)).toEqual([[0, 1], [2, 3], [4]]);
    expect(buildRows(4, 'two-page', false)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('leaves the first page alone with a cover page', () => {
    expect(buildRows(5, 'two-page', true)).toEqual([[0], [1, 2], [3, 4]]);
    expect(buildRows(4, 'two-page', true)).toEqual([[0], [1, 2], [3]]);
    expect(buildRows(0, 'two-page', true)).toEqual([]);
  });
});

describe('rowOfPage', () => {
  it('agrees with buildRows', () => {
    for (const layout of ['single', 'two-page'] as const) {
      for (const cover of [false, true]) {
        const rows = buildRows(11, layout, cover);
        rows.forEach((row, index) => {
          for (const page of row) expect(rowOfPage(page, layout, cover)).toBe(index);
        });
      }
    }
  });
});

describe('measureRows', () => {
  it('adds widths and takes the tallest page of each row', () => {
    const sizes = [600, 800, 300, 900, 500, 400];
    const measured = measureRows(buildRows(3, 'two-page', false), sizes);
    expect([...measured.widths]).toEqual([900, 500]);
    expect([...measured.heights]).toEqual([900, 400]);
    expect(measured.widest).toBe(900);
    expect(measured.tallest).toBe(900);
  });
});

describe('resolveZoom', () => {
  // A window with room for exactly one 600×800 pt page at real size, twice over.
  const fit: FitInput = {
    availableWidth: 600 * PIXELS_PER_POINT * 2,
    availableHeight: 800 * PIXELS_PER_POINT,
    widestRowPoints: 600,
    tallestRowPoints: 800,
    fixedRowGap: 0,
  };

  it('uses real size and custom zoom as given', () => {
    expect(resolveZoom({ ...DEFAULT_VIEW, zoomMode: 'actual' }, fit)).toBe(1);
    expect(resolveZoom({ ...DEFAULT_VIEW, zoomMode: 'custom', customZoom: 1.5 }, fit)).toBe(1.5);
    expect(resolveZoom({ ...DEFAULT_VIEW, zoomMode: 'custom', customZoom: 99 }, fit)).toBe(64);
  });

  it('fits the width, the height, or the whole page', () => {
    expect(resolveZoom({ ...DEFAULT_VIEW, zoomMode: 'fit-width' }, fit)).toBeCloseTo(2, 2);
    expect(resolveZoom({ ...DEFAULT_VIEW, zoomMode: 'fit-height' }, fit)).toBeCloseTo(1, 2);
    expect(resolveZoom({ ...DEFAULT_VIEW, zoomMode: 'fit-page' }, fit)).toBeCloseTo(1, 2);
  });

  it('stays at real size before the window is measured', () => {
    const unmeasured = { ...fit, availableWidth: 0, availableHeight: 0 };
    expect(resolveZoom({ ...DEFAULT_VIEW, zoomMode: 'fit-page' }, unmeasured)).toBe(1);
  });
});

describe('view rotation', () => {
  it('turns a quarter at a time and comes back around', () => {
    expect(rotateClockwise(0)).toBe(90);
    expect(rotateClockwise(270)).toBe(0);
  });
});
