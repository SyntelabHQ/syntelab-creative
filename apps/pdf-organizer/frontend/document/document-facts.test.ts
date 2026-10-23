import { describe, expect, it } from 'vitest';
import { parsePdfDate, planIndexOf } from './document-facts';
import { planFromDocument, swapPages } from './page-plan';

describe('parsePdfDate', () => {
  it('reads full dates with their time zone', () => {
    expect(parsePdfDate("D:20261009143000+02'00'")?.toISOString()).toBe('2026-10-09T12:30:00.000Z');
    expect(parsePdfDate('D:20261009143000Z')?.toISOString()).toBe('2026-10-09T14:30:00.000Z');
    expect(parsePdfDate("D:20261009143000-05'30'")?.toISOString()).toBe('2026-10-09T20:00:00.000Z');
  });

  it('reads short dates and refuses what is not a date', () => {
    expect(parsePdfDate('D:2026')?.getUTCFullYear()).toBe(2026);
    expect(parsePdfDate('20261009')?.toISOString()).toBe('2026-10-09T00:00:00.000Z');
    expect(parsePdfDate('')).toBeNull();
    expect(parsePdfDate('last Tuesday')).toBeNull();
    expect(parsePdfDate('D:20269999')).toBeNull();
  });
});

describe('planIndexOf', () => {
  it('finds a page of the file where it is now, also after it was changed', () => {
    const [first, second, third] = planFromDocument(1, new Array<number>(6).fill(100));
    const moved = [third!, first!, second!];
    expect(planIndexOf(moved, 1, 2)).toBe(0);
    const changed = swapPages(moved, [0], planFromDocument(9, [50, 50]));
    expect(planIndexOf(changed, 1, 2)).toBe(0);
    expect(planIndexOf([first!], 1, 2)).toBeUndefined();
  });
});
