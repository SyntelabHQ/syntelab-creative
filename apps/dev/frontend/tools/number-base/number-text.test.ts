import { describe, expect, it } from 'vitest';
import { grouped } from './number-text';

describe('digits in groups', () => {
  const gap = '\u2009';

  it('are counted from the end', () => {
    expect(grouped('1000000', 3)).toBe(`1${gap}000${gap}000`);
    expect(grouped('DEADBEEF', 4)).toBe(`DEAD${gap}BEEF`);
    expect(grouped('11110000', 4)).toBe(`1111${gap}0000`);
    expect(grouped('123', 3)).toBe('123');
    expect(grouped('1234', 3)).toBe(`1${gap}234`);
  });

  it('keep the sign before the first group, and nothing is grouped when not asked', () => {
    expect(grouped('-2A', 4)).toBe('-2A');
    expect(grouped('-12345', 3)).toBe(`-12${gap}345`);
    expect(grouped('ZZZZZ', 0)).toBe('ZZZZZ');
    expect(grouped('', 4)).toBe('');
  });
});
