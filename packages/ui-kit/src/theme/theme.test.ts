import { describe, expect, it } from 'vitest';
import { resolveTheme, toneOf } from './theme';

describe('resolveTheme', () => {
  it('keeps an explicit choice', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('tells the gray themes by their tone', () => {
    expect([resolveTheme('light-gray', true), toneOf('light-gray')]).toEqual(['light', 'gray']);
    expect([resolveTheme('dark-gray', false), toneOf('dark-gray')]).toEqual(['dark', 'gray']);
    expect(toneOf('dark')).toBe('plain');
    expect(toneOf('auto')).toBe('plain');
  });

  it('follows the system when automatic', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });
});
