import { describe, expect, it } from 'vitest';
import { EMPTY_RANGE, itemAt, itemsInWindow, layoutStrip } from './strip-layout';

describe('layoutStrip', () => {
  it('stacks items with gaps and padding', () => {
    const layout = layoutStrip([100, 50, 200], 10, 20);
    expect([...layout.tops]).toEqual([20, 130, 190]);
    expect(layout.totalHeight).toBe(20 + 100 + 10 + 50 + 10 + 200 + 20);
  });

  it('handles an empty strip', () => {
    expect(layoutStrip([], 10, 20).totalHeight).toBe(40);
  });
});

describe('itemAt', () => {
  const layout = layoutStrip([100, 50, 200], 10, 20);

  it('finds the item under a position', () => {
    expect(itemAt(layout, 0)).toBe(0);
    expect(itemAt(layout, 119)).toBe(0);
    expect(itemAt(layout, 125)).toBe(0); // in the gap: still the item above
    expect(itemAt(layout, 130)).toBe(1);
    expect(itemAt(layout, 190)).toBe(2);
    expect(itemAt(layout, 99999)).toBe(2);
    expect(itemAt(layout, -50)).toBe(0);
  });
});

describe('itemsInWindow', () => {
  const tall = layoutStrip(Array.from({ length: 2500 }, () => 1000), 16, 16);

  it('returns only what is on screen, plus the overscan', () => {
    expect(itemsInWindow(tall, 0, 800, 0)).toEqual({ first: 0, last: 0 });
    expect(itemsInWindow(tall, 0, 800, 800)).toEqual({ first: 0, last: 1 });
    expect(itemsInWindow(tall, 1016 * 1200, 800, 1016)).toEqual({ first: 1198, last: 1201 });
  });

  it('stays inside the strip at the end', () => {
    expect(itemsInWindow(tall, tall.totalHeight - 800, 800, 5000).last).toBe(2499);
  });

  it('is empty for an empty strip or a hidden window', () => {
    expect(itemsInWindow(layoutStrip([], 16, 16), 0, 800, 0)).toEqual(EMPTY_RANGE);
    expect(itemsInWindow(tall, 0, 0, 100)).toEqual(EMPTY_RANGE);
  });
});
