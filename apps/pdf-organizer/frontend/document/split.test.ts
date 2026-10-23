import { describe, expect, it } from 'vitest';
import { planFromDocument, replacePages } from './page-plan';
import { printPages } from './print-pages';
import { partNumber, splitPlan } from './split';

const plan = (pages: number, documentId = 1) => planFromDocument(documentId, new Array<number>(pages * 2).fill(100));
const pagesOf = (parts: readonly (readonly { page: number }[])[]) => parts.map((part) => part.map((page) => page.page));

describe('splitPlan', () => {
  it('starts a new file every so many pages', () => {
    expect(pagesOf(splitPlan(plan(5), { kind: 'every', pages: 2 }))).toEqual([[0, 1], [2, 3], [4]]);
    expect(pagesOf(splitPlan(plan(3), { kind: 'every', pages: 1 }))).toEqual([[0], [1], [2]]);
  });

  it('keeps the document whole when the size covers it, and never loops on a bad size', () => {
    expect(pagesOf(splitPlan(plan(3), { kind: 'every', pages: 10 }))).toEqual([[0, 1, 2]]);
    expect(pagesOf(splitPlan(plan(2), { kind: 'every', pages: 0 }))).toEqual([[0], [1]]);
    expect(pagesOf(splitPlan(plan(2), { kind: 'every', pages: Number.NaN }))).toEqual([[0], [1]]);
  });

  it('starts a new file at each chosen page', () => {
    expect(pagesOf(splitPlan(plan(6), { kind: 'at', starts: new Set([2, 5]) }))).toEqual([[0, 1], [2, 3, 4], [5]]);
    // The first page always starts the first file.
    expect(pagesOf(splitPlan(plan(3), { kind: 'at', starts: new Set([0]) }))).toEqual([[0, 1, 2]]);
  });
});

describe('partNumber', () => {
  it('pads so the files sort in order', () => {
    expect(partNumber(0, 3)).toBe('1');
    expect(partNumber(0, 12)).toBe('01');
    expect(partNumber(11, 12)).toBe('12');
  });
});

describe('replacePages', () => {
  it('puts the new pages where the first replaced page was', () => {
    const replaced = replacePages(plan(5), new Set([1, 3]), plan(2, 9));
    expect(replaced.plan.map((page) => page.key)).toEqual(['1:0', '9:0', '9:1', '1:2', '1:4']);
    expect([...replaced.chosen]).toEqual([1, 2]);
  });

  it('changes nothing without pages to replace or pages to put in', () => {
    expect(replacePages(plan(3), new Set(), plan(2, 9)).plan.map((page) => page.key)).toEqual(['1:0', '1:1', '1:2']);
    expect(replacePages(plan(3), new Set([1]), []).plan).toHaveLength(3);
  });
});

describe('printPages', () => {
  const host = {
    resourceUrl: (path: string, query: Readonly<Record<string, string | number>> = {}) =>
      `${path}?${Object.entries(query).map(([key, value]) => `${key}=${value}`).join('&')}`,
  };

  it('prints each page as arranged, with its turn, and knows which sheets lie sideways', () => {
    const [first, second] = planFromDocument(4, [100, 200, 300, 200]);
    const pages = printPages(host, [{ ...second!, rotation: 0 }, { ...first!, rotation: 90 }]);
    expect(pages).toMatchObject([
      { url: 'page/4/1?scale=3&rotate=0', landscape: true },
      { url: 'page/4/0?scale=3&rotate=90', landscape: true },
    ]);
    expect(printPages(host, [first!])[0]?.landscape).toBe(false);
  });

  it('draws a long document less finely', () => {
    expect(printPages(host, plan(41))[0]?.url).toContain('scale=2');
  });
});
