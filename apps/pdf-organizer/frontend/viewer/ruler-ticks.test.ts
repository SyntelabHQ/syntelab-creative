import { describe, expect, it } from 'vitest';
import { rulerTicks } from './ruler-ticks';

describe('rulerTicks', () => {
  it('numbers from the edge of the page, in both directions', () => {
    // A millimetre 5 pixels wide: a number every 10 mm, a short mark every millimetre.
    const ticks = rulerTicks(100, 300, 5);
    const numbered = ticks.filter((tick) => tick.major);
    expect(numbered.map((tick) => tick.label)).toEqual(['20', '10', '0', '10', '20', '30', '40']);
    expect(numbered.find((tick) => tick.label === '0')?.at).toBe(100);
    expect(ticks.length).toBe(61);
  });

  it('draws fewer marks when they would crowd', () => {
    // A point 1.33 pixels wide: numbers every 50, short marks every 5 (6.7 pixels).
    const ticks = rulerTicks(0, 400, 1.333);
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.label)).toEqual(['0', '50', '100', '150', '200', '250', '300']);
    expect(ticks[1]?.at).toBeCloseTo(6.665);
  });

  it('halves inches where there is room', () => {
    const ticks = rulerTicks(0, 400, 96);
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.label)).toEqual(['0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4']);
  });

  it('draws nothing without a size', () => {
    expect(rulerTicks(0, 0, 5)).toEqual([]);
    expect(rulerTicks(0, 100, 0)).toEqual([]);
  });
});
