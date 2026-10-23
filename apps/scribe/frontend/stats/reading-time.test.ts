import { describe, expect, it } from 'vitest';
import { minutesAt, readingMinutes, speakingMinutes, timeParts } from './reading-time';

describe('reading time', () => {
  it('takes longer to say a text than to read it', () => {
    expect(readingMinutes(460)).toBe(2);
    expect(speakingMinutes(460)).toBeGreaterThan(readingMinutes(460));
    expect(readingMinutes(0)).toBe(0);
    expect(minutesAt(400, 40)).toBe(10);
    expect(minutesAt(400, 0)).toBe(0);
  });

  it('writes a time as hours, minutes and seconds', () => {
    expect(timeParts(0.5)).toEqual({ hours: 0, minutes: 0, seconds: 30 });
    expect(timeParts(2.25)).toEqual({ hours: 0, minutes: 2, seconds: 15 });
    // From an hour up, seconds are rounded into the minutes.
    expect(timeParts(61.6)).toEqual({ hours: 1, minutes: 2, seconds: 0 });
    expect(timeParts(119.99)).toEqual({ hours: 2, minutes: 0, seconds: 0 });
    expect(timeParts(-1)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });
});
