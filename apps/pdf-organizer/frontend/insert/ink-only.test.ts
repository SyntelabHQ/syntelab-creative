import { describe, expect, it } from 'vitest';
import { keepInk } from './ink-only';

/** Pixels from gray values: one value per pixel, opaque. */
const gray = (...values: number[]) => new Uint8ClampedArray(values.flatMap((value) => [value, value, value, 255]));
const alphaOf = (pixels: Uint8ClampedArray) => [...pixels].filter((_, index) => index % 4 === 3);

describe('keepInk', () => {
  it('makes the paper see-through and keeps the ink', () => {
    // Mostly paper (bright), two strokes of ink (dark).
    const pixels = gray(240, 242, 238, 241, 240, 239, 20, 30);
    keepInk(pixels);
    expect(alphaOf(pixels)).toEqual([0, 0, 0, 0, 0, 0, 255, 255]);
  });

  it('works on paper that is not white: gray, or in shadow', () => {
    const pixels = gray(170, 172, 168, 171, 170, 169, 40, 35);
    keepInk(pixels);
    expect(alphaOf(pixels)).toEqual([0, 0, 0, 0, 0, 0, 255, 255]);
  });

  it('fades the soft edge of a stroke instead of cutting it', () => {
    const pixels = gray(240, 240, 240, 240, 240, 240, 160, 20);
    keepInk(pixels);
    const [, , , , , , edge, ink] = alphaOf(pixels);
    expect(ink).toBe(255);
    expect(edge).toBeGreaterThan(40);
    expect(edge).toBeLessThan(255);
  });

  it('keeps the color of the ink', () => {
    const pixels = new Uint8ClampedArray([250, 250, 250, 255, 250, 250, 250, 255, 250, 250, 250, 255, 20, 30, 160, 255]);
    keepInk(pixels);
    expect([...pixels.slice(12)]).toEqual([20, 30, 160, 255]);
  });
});
