import { describe, expect, it } from 'vitest';
import { readSplit } from './layout';

describe('readSplit', () => {
  it('keeps a part a pane can be dragged to', () => {
    expect(readSplit(0.3)).toBe(0.3);
  });

  it('brings back what is out of reach or no number', () => {
    expect(readSplit(0.01)).toBe(0.15);
    expect(readSplit(2)).toBe(0.85);
    expect(readSplit('half')).toBe(0.5);
    expect(readSplit(Number.NaN)).toBe(0.5);
  });
});
