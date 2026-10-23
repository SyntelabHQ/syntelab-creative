import { describe, expect, it } from 'vitest';
import { planFromDocument, swapPages } from './page-plan';
import { cropRequest, fitRequest, leavesSomething, NO_MARGINS } from './page-shape';

describe('page shape', () => {
  it('asks for margins in points and never for negative ones', () => {
    const request = cropRequest({ left: 25.4, top: 0, right: -3, bottom: Number.NaN });
    expect(request.crop.left).toBeCloseTo(72);
    expect(request.crop).toMatchObject({ top: 0, right: 0, bottom: 0 });
  });

  it('asks for a sheet by its size in points', () => {
    const request = fitRequest('a4', true);
    expect(Math.round(request.fit.width)).toBe(595);
    expect(Math.round(request.fit.height)).toBe(842);
    expect(request.fit.matchOrientation).toBe(true);
  });

  it('knows when margins would leave nothing of a page', () => {
    expect(leavesSomething(NO_MARGINS, 595, 842)).toBe(true);
    expect(leavesSomething({ ...NO_MARGINS, left: 100, right: 100 }, 595, 842)).toBe(true);
    expect(leavesSomething({ ...NO_MARGINS, left: 105, right: 105 }, 595, 842)).toBe(false);
    expect(leavesSomething({ ...NO_MARGINS, top: 300 }, 595, 842)).toBe(false);
  });
});

describe('swapPages', () => {
  it('puts the new pages where the old ones were, one for one', () => {
    const plan = planFromDocument(1, new Array<number>(8).fill(100));
    const reshaped = planFromDocument(9, new Array<number>(4).fill(50));
    expect(swapPages(plan, [1, 3], reshaped).map((page) => page.key)).toEqual(['1:0', '9:0', '1:2', '9:1']);
    expect(swapPages(plan, [7], reshaped)).toHaveLength(4);
  });

  it('remembers which page of the file a changed page was made from, through several changes', () => {
    const plan = planFromDocument(1, new Array<number>(8).fill(100));
    const once = swapPages(plan, [2], planFromDocument(9, [50, 50]));
    const twice = swapPages(once, [2], planFromDocument(12, [50, 50]));
    expect(twice[2]).toMatchObject({ key: '12:0', origin: { documentId: 1, page: 2 } });
    expect(twice[0]?.origin).toBeUndefined();
  });
});
