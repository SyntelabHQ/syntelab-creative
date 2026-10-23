import { describe, expect, it } from 'vitest';
import { pagesOf, parsePageList } from './page-range';

describe('parsePageList', () => {
  it('reads numbers and stretches, however they are separated', () => {
    expect(parsePageList('1, 3, 5-8', 10)).toEqual([0, 2, 4, 5, 6, 7]);
    expect(parsePageList('2;4 6', 10)).toEqual([1, 3, 5]);
    expect(parsePageList('3–5', 10)).toEqual([2, 3, 4]);
  });

  it('reads open stretches and stretches written backward', () => {
    expect(parsePageList('8-', 10)).toEqual([7, 8, 9]);
    expect(parsePageList('-3', 10)).toEqual([0, 1, 2]);
    expect(parsePageList('5-3', 10)).toEqual([4, 3, 2]);
  });

  it('keeps each page once and leaves out pages the document does not have', () => {
    expect(parsePageList('2, 2, 1-3, 99, 0', 5)).toEqual([1, 0, 2]);
    expect(parsePageList('4-900000000', 6)).toEqual([3, 4, 5]);
    expect(parsePageList('', 5)).toEqual([]);
  });

  it('says when a list cannot be read', () => {
    expect(parsePageList('1, two', 5)).toBeNull();
    expect(parsePageList('1.5', 5)).toBeNull();
    expect(parsePageList('-', 5)).toBeNull();
  });
});

describe('pagesOf', () => {
  const chosen = new Set([4, 1]);
  it('lists the pages of a range, in the order of the document', () => {
    expect(pagesOf({ kind: 'all' }, 'both', 4, chosen)).toEqual([0, 1, 2, 3]);
    expect(pagesOf({ kind: 'chosen' }, 'both', 6, chosen)).toEqual([1, 4]);
    expect(pagesOf({ kind: 'from-to', from: 2, to: 4 }, 'both', 6, chosen)).toEqual([1, 2, 3]);
    expect(pagesOf({ kind: 'from-to', from: 5, to: 99 }, 'both', 6, chosen)).toEqual([4, 5]);
    expect(pagesOf({ kind: 'from-to', from: 4, to: 2 }, 'both', 6, chosen)).toEqual([1, 2, 3]);
    expect(pagesOf({ kind: 'custom', list: '6, 1-2' }, 'both', 6, chosen)).toEqual([0, 1, 5]);
    expect(pagesOf({ kind: 'custom', list: 'nonsense' }, 'both', 6, chosen)).toEqual([]);
  });

  it('keeps the odd or the even pages, counted from 1', () => {
    expect(pagesOf({ kind: 'all' }, 'odd', 5, chosen)).toEqual([0, 2, 4]);
    expect(pagesOf({ kind: 'all' }, 'even', 5, chosen)).toEqual([1, 3]);
    expect(pagesOf({ kind: 'chosen' }, 'even', 6, chosen)).toEqual([1]);
  });
});
