import { describe, expect, it } from 'vitest';
import { printsSideways, sheetRules } from './print-images';

describe('printing', () => {
  it('turns the sheet for wide pages, unless told how every sheet lies', () => {
    const wide = { url: 'a', landscape: true };
    const tall = { url: 'b', landscape: false };
    expect(printsSideways(wide, undefined)).toBe(true);
    expect(printsSideways(tall, 'auto')).toBe(false);
    expect(printsSideways(wide, 'portrait')).toBe(false);
    expect(printsSideways(tall, 'landscape')).toBe(true);
  });

  it('names the paper for the print window, upright and turned', () => {
    expect(sheetRules({ width: 210, height: 297 })).toBe('@page { size: 210mm 297mm; margin: 0; } @page sc-wide { size: 297mm 210mm; margin: 0; }');
    // Without a size, the printer's own paper is used.
    expect(sheetRules(undefined)).toBe('');
  });
});
