import { describe, expect, it } from 'vitest';
import { nibWidth, PEN_PRESETS } from './signature-pens';

describe('pen presets', () => {
  it('can be told apart by their icons', () => {
    expect(new Set(PEN_PRESETS.map((pen) => pen.icon)).size).toBe(PEN_PRESETS.length);
  });
});

describe('nibWidth', () => {
  it('draws thinner when the hand is fast, without jumping', () => {
    const slow = nibWidth(4, 0, 4);
    const fast = nibWidth(4, 3, 4);
    expect(slow).toBeGreaterThan(4);
    expect(fast).toBeLessThan(4);
    expect(fast).toBeGreaterThan(4 * 0.4);
  });
});
