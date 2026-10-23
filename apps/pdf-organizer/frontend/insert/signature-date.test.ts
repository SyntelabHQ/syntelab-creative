import { describe, expect, it } from 'vitest';
import { dayOf, writtenDate } from './signature-date';

describe('signature dates', () => {
  it('names a day the way a date field does', () => {
    expect(dayOf(new Date(2026, 9, 3, 23, 30))).toBe('2026-10-03');
  });

  it('writes a day as the language does', () => {
    expect(writtenDate('2026-10-03', 'ro')).toBe('03.10.2026');
    expect(writtenDate('2026-10-03', 'en-GB')).toBe('03/10/2026');
  });

  it('writes nothing for what is no day', () => {
    expect(writtenDate('', 'ro')).toBe('');
    expect(writtenDate('soon', 'ro')).toBe('');
  });
});
