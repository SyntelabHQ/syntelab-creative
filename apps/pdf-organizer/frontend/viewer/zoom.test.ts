import { describe, expect, it } from 'vitest';
import { parseZoom, renderScale, zoomIn, zoomOut } from './zoom';

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
    expect(renderScale(1, 1)).toBe(1.33);
    expect(renderScale(1.5, 2)).toBe(4);
  });

  it('is capped', () => {
    expect(renderScale(4, 3)).toBe(8);
  });
});
