import { describe, expect, it } from 'vitest';
import { placeTooltip } from './place-tooltip';

const window = { width: 1000, height: 600 };
const tip = { width: 200, height: 30 };

describe('placeTooltip', () => {
  it('centers under the control', () => {
    expect(placeTooltip({ left: 400, top: 100, width: 40, height: 40 }, tip, 'bottom', window)).toEqual({ left: 320, top: 146 });
  });

  it('stays whole inside the window at its edges', () => {
    expect(placeTooltip({ left: 10, top: 100, width: 40, height: 40 }, tip, 'bottom', window).left).toBe(6);
    expect(placeTooltip({ left: 950, top: 100, width: 40, height: 40 }, tip, 'bottom', window).left).toBe(794);
  });

  it('goes to the other side when its own has no room', () => {
    expect(placeTooltip({ left: 400, top: 560, width: 40, height: 30 }, tip, 'bottom', window).top).toBe(524);
    expect(placeTooltip({ left: 400, top: 10, width: 40, height: 30 }, tip, 'top', window).top).toBe(46);
    expect(placeTooltip({ left: 900, top: 100, width: 40, height: 40 }, tip, 'end', window).left).toBe(694);
  });

  it('follows the reading direction', () => {
    const control = { left: 400, top: 100, width: 40, height: 40 };
    expect(placeTooltip(control, tip, 'end', window).left).toBe(446);
    expect(placeTooltip(control, tip, 'end', window, true).left).toBe(194);
    expect(placeTooltip(control, tip, 'bottom-end', window).left).toBe(240);
    expect(placeTooltip(control, tip, 'bottom-end', window, true).left).toBe(400);
  });
});
