import { describe, expect, it } from 'vitest';
import { fitGroups } from './fit-groups';

describe('fitGroups', () => {
  const fit = (available: number) => fitGroups([300, 200, 400], 80, available);

  it('keeps every group open when they fit', () => {
    expect(fit(900)).toEqual(['full', 'full', 'full']);
  });

  it('folds groups from the end as the width shrinks', () => {
    expect(fit(899)).toEqual(['full', 'full', 'folded']); // 300+200+80
    expect(fit(500)).toEqual(['full', 'folded', 'folded']); // 300+80+80
    expect(fit(100)).toEqual(['folded', 'folded', 'folded']);
  });

  it('copes with no groups, and never widens a group by folding it', () => {
    expect(fitGroups([], 80, 10)).toEqual([]);
    // A one-button group is narrower open (70) than folded (80): its width stays 70.
    expect(fitGroups([70], 80, 75)).toEqual(['full']);
  });
});
