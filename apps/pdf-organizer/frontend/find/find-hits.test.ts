import { describe, expect, it } from 'vitest';
import { planFromDocument } from '../document/page-plan';
import { compareHits, hitsOnPlan, planPlaces, stepHit, turnBox } from './find-hits';
import type { Hit } from './find-hits';

describe('hitsOnPlan', () => {
  it('puts what was found in a file on the pages of the plan, wherever they moved', () => {
    const [first, second, third] = planFromDocument(7, [100, 200, 100, 200, 100, 200]);
    // Page 2 of the file was removed, page 3 moved to the front.
    const places = planPlaces([third!, first!]).get(7)!;
    const hits = hitsOnPlan(
      [
        { page: 0, boxes: [10, 20, 30, 5] },
        { page: 1, boxes: [1, 2, 3, 4] },
        { page: 2, boxes: [50, 60, 20, 5, 50, 80, 20, 5] },
      ],
      places,
    ).sort(compareHits);
    expect(hits).toEqual([
      { page: 0, x: 50, y: 60, width: 20, height: 5 },
      { page: 0, x: 50, y: 80, width: 20, height: 5 },
      { page: 1, x: 10, y: 20, width: 30, height: 5 },
    ]);
    expect(second).toBeDefined();
  });
});

describe('turnBox', () => {
  const box = { x: 10, y: 20, width: 30, height: 5 };

  it('follows the page when it is turned', () => {
    expect(turnBox(box, 100, 200, 0)).toEqual(box);
    expect(turnBox(box, 100, 200, 90)).toEqual({ x: 175, y: 10, width: 5, height: 30 });
    expect(turnBox(box, 100, 200, 180)).toEqual({ x: 60, y: 175, width: 30, height: 5 });
    expect(turnBox(box, 100, 200, 270)).toEqual({ x: 20, y: 60, width: 5, height: 30 });
  });

  it('comes back after four quarter turns', () => {
    let turned = box;
    let [width, height] = [100, 200];
    for (let quarter = 0; quarter < 4; quarter++) {
      turned = turnBox(turned, width, height, 90);
      [width, height] = [height, width];
    }
    expect(turned).toEqual(box);
  });
});

describe('stepHit', () => {
  const hit = (page: number): Hit => ({ page, x: 0, y: 0, width: 1, height: 1 });
  const hits = [hit(1), hit(4), hit(4), hit(9)];

  it('starts from the page in view', () => {
    expect(stepHit(hits, -1, 1, 3)).toBe(1);
    expect(stepHit(hits, -1, -1, 3)).toBe(0);
    expect(stepHit(hits, -1, 1, 20)).toBe(0);
    expect(stepHit(hits, -1, -1, 0)).toBe(3);
  });

  it('goes on from the active hit and wraps around', () => {
    expect(stepHit(hits, 1, 1, 0)).toBe(2);
    expect(stepHit(hits, 3, 1, 0)).toBe(0);
    expect(stepHit(hits, 0, -1, 0)).toBe(3);
    expect(stepHit([], -1, 1, 0)).toBe(-1);
  });
});
