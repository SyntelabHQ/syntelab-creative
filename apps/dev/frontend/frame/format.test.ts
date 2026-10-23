import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration } from './format';

describe('formatBytes', () => {
  it('writes a size in the largest unit that keeps it short', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(1023, 'en')).toBe('1,023 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(369_914_298, 'en')).toBe('353 MB');
    expect(formatBytes(5 * 1024 ** 4, 'en')).toBe('5 TB');
  });

  it('writes the number as the language does', () => {
    expect(formatBytes(1536, 'ro')).toBe('1,5 KB');
  });
});

describe('formatDuration', () => {
  it('goes from milliseconds to minutes', () => {
    expect(formatDuration(12.4, 'en')).toBe('12 ms');
    expect(formatDuration(1334, 'en')).toBe('1.3 s');
    expect(formatDuration(125_000, 'en')).toBe('2 min 5 s');
  });
});
