/**
 * The digits of a number in groups, counted from its end, with a thin gap
 * between them, to be read more easily: `1 000 000`, `DEAD BEEF`,
 * `1111 0000`. The sign stays before the first group. `each` of 0 leaves
 * the digits as they are.
 */
export function grouped(written: string, each: number): string {
  if (each <= 0) return written;
  const sign = written.startsWith('-') ? '-' : '';
  const digits = written.slice(sign.length);
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= each) groups.unshift(digits.slice(Math.max(0, end - each), end));
  // A thin space: a long number goes on to the next line between two groups, not inside one.
  return sign + groups.join('\u2009');
}
