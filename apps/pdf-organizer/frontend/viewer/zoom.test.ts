import { describe, expect, it } from 'vitest';
import {
  baseScale,
  isTiled,
  onWholePixels,
  parseZoom,
  picturePixels,
  PIXELS_PER_POINT,
  renderScale,
  screenScale,
  tilesInView,
  zoomIn,
  zoomOut,
} from './zoom';

describe('zoom steps', () => {
  it('moves to the next and previous step', () => {
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomIn(1.1)).toBe(1.25);
    expect(zoomOut(1.1)).toBe(1);
  });

  it('stops at the ends', () => {
    expect(zoomIn(64)).toBe(64);
    expect(zoomOut(0.01)).toBe(0.01);
  });

  it('has the steps other PDF programs have', () => {
    expect(zoomIn(0.5)).toBe(0.667);
    expect(zoomIn(4)).toBe(6);
    expect(zoomOut(0.125)).toBe(0.065);
  });
});

describe('parseZoom', () => {
  it('reads what people type', () => {
    expect(parseZoom('150', 0.01, 64)).toBe(1.5);
    expect(parseZoom(' 66,7 % ', 0.01, 64)).toBeCloseTo(0.667);
    expect(parseZoom('12.5%', 0.01, 64)).toBe(0.125);
  });

  it('keeps to what can be shown and refuses what is not a number', () => {
    expect(parseZoom('99999', 0.01, 64)).toBe(64);
    expect(parseZoom('0.1', 0.01, 64)).toBe(0.01);
    expect(parseZoom('big', 0.01, 64)).toBeNull();
    expect(parseZoom('0', 0.01, 64)).toBeNull();
  });
});

describe('renderScale', () => {
  it('accounts for zoom and screen density', () => {
    expect(renderScale(1, 1)).toBeCloseTo(1.3333, 4);
    expect(renderScale(1.5, 2)).toBe(4);
  });

  it('is capped', () => {
    expect(renderScale(4, 3)).toBe(8);
  });

  it('gives the picture the size the page has on screen, in whole pixels', () => {
    // An A4 page at 100% on a screen at 125%: the picture and the page are the same 992 pixels wide.
    const width = 595.28;
    const scale = renderScale(1, 1.25);
    expect(Math.round(width * scale)).toBe(992);
    expect(onWholePixels(width * PIXELS_PER_POINT, 1.25) * 1.25).toBeCloseTo(992, 6);
  });
});

describe('onWholePixels', () => {
  it('rounds to the pixels of the screen', () => {
    expect(onWholePixels(793.7, 1)).toBe(794);
    expect(onWholePixels(793.7, 1.25)).toBe(793.6);
    expect(onWholePixels(793.7, 2)).toBe(793.5);
  });
});

describe('pages drawn in pieces', () => {
  it('draws a page in pieces only once it is large on screen', () => {
    // A4 at 100% on an ordinary screen: whole. At 300% on a sharp one: in pieces.
    expect(isTiled(picturePixels(595, 842, screenScale(1, 1)))).toBe(false);
    expect(isTiled(picturePixels(595, 842, screenScale(3, 1.5)))).toBe(true);
    // The pieces go far beyond what a whole page may be drawn at.
    expect(screenScale(64, 2)).toBeGreaterThan(100);
  });

  it('draws the page under the pieces as sharp as a page not in pieces, and no sharper', () => {
    const scale = baseScale(595, 842, 10);
    const { width, height } = picturePixels(595, 842, scale);
    expect(width * height).toBeLessThanOrEqual(4_000_000 * 1.01);
    expect(width * height).toBeGreaterThan(4_000_000 * 0.99);
    expect(baseScale(100, 100, 2)).toBe(2);
  });

  it('asks for the pieces in view and one more all around, cut at the edges', () => {
    const tiles = tilesInView({ width: 1300, height: 2000 }, { left: 600, top: 600, right: 700, bottom: 700 }, 512);
    expect(tiles.map((tile) => `${tile.x},${tile.y}`)).toEqual(['0,0', '512,0', '1024,0', '0,512', '512,512', '1024,512', '0,1024', '512,1024', '1024,1024']);
    expect(tiles[2]).toEqual({ x: 1024, y: 0, width: 276, height: 512 });
    // Far from view: nothing.
    expect(tilesInView({ width: 1300, height: 2000 }, { left: 0, top: 5000, right: 100, bottom: 5100 }, 512)).toEqual([]);
  });
});
