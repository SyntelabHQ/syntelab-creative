import { describe, expect, it } from 'vitest';
import { clampEdges, dragHandle, edgesOfFrame, frameOf, fromUnit, moveFrame, NO_EDGES, shownEdges, toUnit } from './crop-frame';

describe('units', () => {
  it('turns points into what people type, and back', () => {
    expect(toUnit(72, 'in')).toBe(1);
    expect(toUnit(72, 'mm')).toBe(25.4);
    expect(toUnit(10.4, 'pt')).toBe(10);
    expect(fromUnit(25.4, 'mm')).toBeCloseTo(72);
    expect(fromUnit(Number.NaN, 'mm')).toBe(0);
    expect(fromUnit(-3, 'pt')).toBe(0);
  });
});

describe('the frame that is kept', () => {
  it('is what the edges leave', () => {
    expect(frameOf({ left: 10, top: 20, right: 30, bottom: 40 }, 200, 300)).toEqual({ x: 10, y: 20, width: 160, height: 240 });
  });

  it('comes from two corners drawn in any order', () => {
    expect(edgesOfFrame({ x: 150, y: 250 }, { x: 50, y: 30 }, 200, 300)).toEqual({ left: 50, top: 30, right: 50, bottom: 50 });
  });

  it('always leaves something of the page', () => {
    const edges = clampEdges({ left: 500, top: -5, right: 500, bottom: 290 }, 200, 300);
    expect(edges.left + edges.right).toBeLessThanOrEqual(192);
    expect(edges.top).toBe(0);
    expect(edges.bottom).toBe(290);
  });

  it('follows a handle, which cannot cross the opposite edge', () => {
    const edges = { left: 10, top: 10, right: 10, bottom: 10 };
    expect(dragHandle(edges, 'se', { x: 150, y: 200 }, 200, 300)).toEqual({ left: 10, top: 10, right: 50, bottom: 100 });
    expect(dragHandle(edges, 'w', { x: 500, y: 0 }, 200, 300).left).toBe(182);
    expect(dragHandle(edges, 'n', { x: 0, y: 40 }, 200, 300)).toEqual({ left: 10, top: 40, right: 10, bottom: 10 });
  });

  it('moves as a whole and stops at the edges of the page', () => {
    const edges = { left: 10, top: 20, right: 30, bottom: 40 };
    expect(moveFrame(edges, 5, -5)).toEqual({ left: 15, top: 15, right: 25, bottom: 45 });
    expect(moveFrame(edges, 100, -100)).toEqual({ left: 40, top: 0, right: 0, bottom: 60 });
    expect(moveFrame(NO_EDGES, 10, 10)).toEqual(NO_EDGES);
  });
});

describe('shownEdges', () => {
  it('follows the turn the user gave the page', () => {
    const own = [1, 2, 3, 4] as const;
    expect(shownEdges(own, 0)).toEqual({ left: 1, top: 2, right: 3, bottom: 4 });
    // Turned a quarter clockwise, the page's own left edge is on top.
    expect(shownEdges(own, 90)).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(shownEdges(own, 180)).toEqual({ right: 1, bottom: 2, left: 3, top: 4 });
    expect(shownEdges(own, 270)).toEqual({ bottom: 1, left: 2, top: 3, right: 4 });
  });
});

