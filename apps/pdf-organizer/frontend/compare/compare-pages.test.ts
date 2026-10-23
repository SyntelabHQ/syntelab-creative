import { describe, expect, it } from 'vitest';
import { comparePages, nextDifference } from './compare-pages';

describe('comparePages', () => {
  it('calls pages the same when only the spacing differs', () => {
    const [page] = comparePages(['Total:  100\n\nThank you'], ['Total: 100\nThank you  ']);
    expect(page).toMatchObject({ status: 'same', removed: [], added: [] });
  });

  it('lists the lines each side has alone, in order, counting repeats', () => {
    const [page] = comparePages(['A\nB\nB\nC'], ['A\nB\nD']);
    expect(page).toMatchObject({ status: 'different', removed: ['B', 'C'], added: ['D'] });
  });

  it('does not mind lines that changed places on the page', () => {
    expect(comparePages(['A\nB'], ['B\nA'])[0]?.status).toBe('same');
  });

  it('knows pages that only one document has', () => {
    const pages = comparePages(['one', 'two'], ['one']);
    expect(pages.map((page) => page.status)).toEqual(['same', 'only-first']);
    expect(pages[1]?.removed).toEqual(['two']);
    expect(comparePages([], ['x'])[0]).toMatchObject({ status: 'only-second', added: ['x'] });
  });
});

describe('nextDifference', () => {
  const pages = comparePages(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'y']);

  it('steps between the pages that differ and wraps around', () => {
    expect(nextDifference(pages, 0, 1)).toBe(1);
    expect(nextDifference(pages, 1, 1)).toBe(3);
    expect(nextDifference(pages, 3, 1)).toBe(1);
    expect(nextDifference(pages, 1, -1)).toBe(3);
  });

  it('finds nothing when the documents are the same', () => {
    expect(nextDifference(comparePages(['a'], ['a']), 0, 1)).toBeNull();
    expect(nextDifference([], 0, 1)).toBeNull();
  });
});
