import { describe, expect, it } from 'vitest';
import type { PlanPage } from '../document/page-plan';
import type { Mark } from '../marks/mark';
import { shownCorners, toPageGrid, watermarkOn } from './watermark-marks';

const page = (rotation: PlanPage['rotation'] = 0): PlanPage => ({ key: 'p', documentId: 1, page: 0, rotation, width: 600, height: 800 });
const sample: Mark = { id: 's', kind: 'picture', x: 0, y: 0, width: 200, height: 50, rotation: 0, stroke: null, fill: null, opacity: 1, lineWidth: 1 };
const scaled = (mark: Mark, width: number): Mark => ({ ...mark, width, height: (width * mark.height) / mark.width });
const bounds = (mark: Mark, on: PlanPage) => {
  const corners = shownCorners(mark, on);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
};

describe('watermarkOn', () => {
  it('lies straight across the middle, as wide as asked', () => {
    const mark = watermarkOn(page(), sample, { place: { across: 0, down: 0 }, angle: 'straight', share: 0.5, opacity: 0.3 }, scaled, 'w');
    expect(mark).toMatchObject({ id: 'w', width: 300, height: 75, x: 150, y: 362.5, rotation: 0, opacity: 0.3 });
  });

  it('takes the share asked for when slanted too', () => {
    const mark = watermarkOn(page(), sample, { place: { across: 0, down: 0 }, angle: 'rising', share: 0.8, opacity: 1 }, scaled, 'w');
    const box = bounds(mark, page());
    expect(box.right - box.left).toBeCloseTo(480, 3);
    expect(mark.rotation).toBe(315);
  });

  it('keeps to its corner, a margin away from the edges', () => {
    const on = page();
    const mark = watermarkOn(on, sample, { place: { across: 1, down: -1 }, angle: 'falling', share: 0.4, opacity: 1 }, scaled, 'w');
    const box = bounds(mark, on);
    expect(box.right).toBeCloseTo(570, 3);
    expect(box.top).toBeCloseTo(30, 3);
  });

  it('lies as asked for the reader on a page the user turned', () => {
    const turned = page(90);
    // Shown, the page is 800 wide and 600 tall.
    const mark = watermarkOn(turned, sample, { place: { across: -1, down: 1 }, angle: 'straight', share: 0.25, opacity: 1 }, scaled, 'w');
    const box = bounds(mark, turned);
    expect(box.right - box.left).toBeCloseTo(200, 3);
    expect(box.bottom - box.top).toBeCloseTo(50, 3);
    expect(box.left).toBeCloseTo(30, 3);
    expect(box.bottom).toBeCloseTo(570, 3);
    expect(mark.rotation).toBe(270);
  });
});

describe('toPageGrid', () => {
  it('finds a place of the shown page in the page as its file has it', () => {
    expect(toPageGrid({ x: 10, y: 20 }, page(0))).toEqual({ x: 10, y: 20 });
    // Turned a quarter clockwise, the top-left of what is shown is the bottom-left of the page.
    expect(toPageGrid({ x: 0, y: 0 }, page(90))).toEqual({ x: 0, y: 800 });
    expect(toPageGrid({ x: 0, y: 0 }, page(180))).toEqual({ x: 600, y: 800 });
    expect(toPageGrid({ x: 0, y: 0 }, page(270))).toEqual({ x: 600, y: 0 });
  });
});
