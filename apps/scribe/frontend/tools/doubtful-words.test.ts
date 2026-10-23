import { describe, expect, it } from 'vitest';
import { around, sameWord, withoutDiacritics } from './doubtful-words';

describe('doubtful words', () => {
  it('are the same word whatever their diacritics and capitals', () => {
    expect(withoutDiacritics('Țară')).toBe('tara');
    expect(withoutDiacritics('ÎNȚELEPCIUNE')).toBe('intelepciune');
    expect(sameWord('fata', 'Față')).toBe(true);
    expect(sameWord('ţara', 'țară')).toBe(true);
    expect(sameWord('fata', 'fete')).toBe(false);
  });

  it('are shown with the text around them, cut at whole words', () => {
    const text = 'Copiii se jucau in gradina pana seara tarziu, cand mama ii chema.';
    const from = text.indexOf('gradina');
    const shown = around(text, from, from + 7);
    expect(shown.before.endsWith('in ')).toBe(true);
    expect(shown.before.startsWith('Copiii') || !shown.before.includes('Copiii')).toBe(true);
    expect(shown.after.startsWith(' pana')).toBe(true);
    expect(shown.after.endsWith(' ')).toBe(false);
    expect(around('a\nfata\nb', 2, 6)).toEqual({ before: 'a ', after: ' b' });
  });
});
