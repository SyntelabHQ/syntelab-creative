import { describe, expect, it } from 'vitest';
import { fitGroups, fitIconGroups } from './fit-groups';

describe('fitGroups', () => {
  const groups = [
    { full: 300, compact: 120 },
    { full: 200, compact: 90 },
    { full: 400, compact: 150 },
  ];
  const fit = (available: number) => fitGroups(groups, 80, available);

  it('keeps every group full when they fit', () => {
    expect(fit(900)).toEqual(['full', 'full', 'full']);
  });

  it('makes groups compact from the end as the width shrinks', () => {
    expect(fit(899)).toEqual(['full', 'full', 'compact']); // 300+200+150
    expect(fit(600)).toEqual(['full', 'compact', 'compact']); // 300+90+150
    expect(fit(500)).toEqual(['compact', 'compact', 'compact']); // 120+90+150
  });

  it('folds groups from the end once all are compact', () => {
    expect(fit(359)).toEqual(['compact', 'compact', 'folded']); // 120+90+80
    expect(fit(280)).toEqual(['compact', 'folded', 'folded']);
    expect(fit(100)).toEqual(['folded', 'folded', 'folded']);
  });

  it('copes with no groups, and never widens a group by shrinking it', () => {
    expect(fitGroups([], 80, 10)).toEqual([]);
    // A one-button group is narrower full (70) than folded (80): its width stays 70.
    expect(fitGroups([{ full: 70, compact: 70 }], 80, 75)).toEqual(['full']);
  });

  it('keeps a ribbon of icons as icons, folding from the end', () => {
    expect(fitIconGroups([100, 100, 100], 80, 300)).toEqual(['icons', 'icons', 'icons']);
    expect(fitIconGroups([100, 100, 100], 80, 290)).toEqual(['icons', 'icons', 'folded']);
    expect(fitIconGroups([100, 100, 100], 80, 240)).toEqual(['folded', 'folded', 'folded']);
  });
});
