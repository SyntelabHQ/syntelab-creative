import { describe, expect, it } from 'vitest';
import { placeOf, signedPages, spotAt, spotBox, spotOfBox } from './sign-settings';

describe('sign settings', () => {
  it('puts a usual place inside the margins of the page', () => {
    expect(spotBox(600, 800, spotAt('bottom-right'))).toEqual({ x: 382, y: 708, width: 190, height: 64 });
    expect(spotBox(600, 800, spotAt('top-left'))).toMatchObject({ x: 28, y: 28 });
  });

  it('keeps a drawn place in proportion on a page of another size', () => {
    const spot = spotOfBox(600, 800, { x: 205, y: 368, width: 190, height: 64 });
    expect(spot.across).toBeCloseTo(0.5);
    expect(spot.down).toBeCloseTo(0.5);
    // A landscape page: still in the middle, of the same size.
    const box = spotBox(800, 600, spot);
    expect(box.x + box.width / 2).toBeCloseTo(400);
    expect(box.y + box.height / 2).toBeCloseTo(300);
    expect(box.width).toBe(190);
  });

  it('finds the usual place again from its spot', () => {
    expect(placeOf(spotAt('bottom-center'))).toBe('bottom-center');
    expect(placeOf({ across: 0.3, down: 1, width: 190, height: 64 })).toBeNull();
  });

  it('chooses the pages a signature shows on', () => {
    expect(signedPages('first', 3)).toEqual([0]);
    expect(signedPages('last', 3)).toEqual([2]);
    expect(signedPages('all', 3)).toEqual([0, 1, 2]);
    expect(signedPages('none', 3)).toEqual([]);
    expect(signedPages('all', 0)).toEqual([]);
  });
});
