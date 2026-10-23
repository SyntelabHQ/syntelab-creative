import { describe, expect, it } from 'vitest';
import type { PlanPage } from '../document/page-plan';
import { pagesForAnother } from './page-clipboard';

const page = (documentId: number, number: number): PlanPage => ({ key: `${documentId}:${number}`, documentId, page: number, rotation: 90, width: 600, height: 800 });

describe('pagesForAnother', () => {
  it('gives the pages of the copied document under the id it was opened with', () => {
    const copied = { pages: [page(4, 0), page(9, 3), page(4, 2)], documentId: 4, path: 'C:/a.pdf' };
    const taken = pagesForAnother(copied, 12);
    // The page brought in from a third file (document 9) stays behind.
    expect(taken.map((taken) => [taken.documentId, taken.page, taken.rotation])).toEqual([
      [12, 0, 90],
      [12, 2, 90],
    ]);
  });
});
