import { describe, expect, it } from 'vitest';
import { countWords } from './count-words';

describe('countWords', () => {
  it('counts words whatever is between them', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  one,two;three\n\nfour — five.  ')).toBe(5);
  });

  it('keeps a word with an apostrophe or a hyphen inside it whole', () => {
    expect(countWords("don't stop well-known l’été")).toBe(4);
    // A dash between words is not part of them.
    expect(countWords('yes - no')).toBe(2);
  });

  it('counts letters of any alphabet, and numbers', () => {
    expect(countWords('Șase țări, în 2026')).toBe(4);
    expect(countWords('Привет мир')).toBe(2);
    expect(countWords('مرحبا بالعالم')).toBe(2);
  });

  it('finds the words of a text written without spaces', () => {
    // "I am a student": several words, not one run of characters.
    expect(countWords('私は学生です', 'ja')).toBeGreaterThan(1);
  });
});
