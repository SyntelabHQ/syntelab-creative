import { describe, expect, it } from 'vitest';
import type { PlanPage } from '../document/page-plan';
import type { Mark } from './mark';
import { placedOnPage } from './place-on-page';

const page = (rotation: PlanPage['rotation']): PlanPage => ({ key: 'p', documentId: 1, page: 0, rotation, width: 600, height: 800 });
const box: Mark = { id: 'm', kind: 'rectangle', x: 100, y: 100, width: 200, height: 50, rotation: 0, stroke: '#000000', fill: null, opacity: 1, lineWidth: 1 };

describe('placedOnPage', () => {
  it('centers across and leaves the height alone', () => {
    expect(placedOnPage(box, page(0), 0, null)).toMatchObject({ x: 200, y: 100 });
  });

  it('goes against the edges', () => {
    expect(placedOnPage(box, page(0), 1, 1)).toMatchObject({ x: 400, y: 750 });
    expect(placedOnPage(box, page(0), -1, -1)).toMatchObject({ x: 0, y: 0 });
  });

  it('counts the room a turned mark takes', () => {
    // Turned a quarter, it is 50 wide and 200 tall about the same middle (200, 125).
    expect(placedOnPage({ ...box, rotation: 90 }, page(0), -1, null)).toMatchObject({ x: -75, y: 100 });
  });

  it('works as the reader sees a turned page', () => {
    // Shown a quarter turned, the page is 800 wide; its left edge is the bottom of the page's own grid.
    const moved = placedOnPage(box, page(90), -1, null);
    expect(moved).toMatchObject({ x: 100, y: 750 });
  });
});
