import { describe, expect, it } from 'vitest';
import { placePopup } from './place-popup';

const window = { width: 1000, height: 800 };

describe('placePopup', () => {
  it('opens under its control, as wide as it, when there is room', () => {
    expect(placePopup({ left: 500, top: 100, width: 400, height: 50 }, 380, window)).toEqual({ left: 500, width: 400, top: 156, maxHeight: 380 });
  });

  it('grows only as far as the window when the room under it is the larger', () => {
    // 800 - 520 - 6 - 8 = 266 under, 514 above: it goes above.
    expect(placePopup({ left: 500, top: 470, width: 400, height: 50 }, 380, window)).toEqual({ left: 500, width: 400, bottom: 336, maxHeight: 380 });
    // 800 - 350 - 6 - 8 = 436 under; it fits there.
    expect(placePopup({ left: 500, top: 300, width: 400, height: 50 }, 380, window).top).toBe(356);
    // Little room either way: it stays under and scrolls.
    const short = { width: 1000, height: 300 };
    expect(placePopup({ left: 500, top: 100, width: 400, height: 50 }, 380, short)).toEqual({ left: 500, width: 400, top: 156, maxHeight: 136 });
  });

  it('lines up with the asked edge and stays inside the window', () => {
    expect(placePopup({ left: 900, top: 10, width: 40, height: 40 }, 300, window, { width: 340, align: 'end' }).left).toBe(600);
    expect(placePopup({ left: 900, top: 10, width: 40, height: 40 }, 300, window, { width: 340, align: 'end', rightToLeft: true }).left).toBe(652);
    expect(placePopup({ left: 0, top: 10, width: 40, height: 40 }, 300, { width: 200, height: 800 }, { width: 340 })).toMatchObject({ left: 8, width: 184 });
  });
});
