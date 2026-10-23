import { describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import { against, LIMITS } from './limits';
import { EASE_LEVELS, easeLevel, formulaLanguage, READABILITY_LANGUAGES, readingEase } from './readability';

const texts: Record<string, string> = en;

describe('how easy a text is to read', () => {
  it('is worked out by the formula of its language', () => {
    // "The cat sat on the mat." — six words, one sentence, six syllables: as easy as English gets.
    expect(readingEase({ words: 6, sentences: 1, syllables: 6 }, 'en')).toBe(100);
    // Long sentences of long words are hard.
    const hard = readingEase({ words: 120, sentences: 3, syllables: 260 }, 'en');
    expect(hard).not.toBeNull();
    expect(hard ?? 100).toBeLessThan(10);
    // The same text scores differently in a language whose words are longer by nature.
    const facts = { words: 100, sentences: 6, syllables: 190 };
    expect(readingEase(facts, 'de') ?? 0).toBeGreaterThan(readingEase(facts, 'en') ?? 100);
    expect(readingEase(facts, 'pt-BR')).toBe(readingEase(facts, 'pt'));
  });

  it('is not guessed for a language without a formula, or a text without a sentence', () => {
    expect(formulaLanguage('ro')).toBeNull();
    expect(readingEase({ words: 10, sentences: 1, syllables: 20 }, 'ro')).toBeNull();
    expect(readingEase({ words: 0, sentences: 0, syllables: 0 }, 'en')).toBeNull();
    expect(READABILITY_LANGUAGES).toContain('fr');
  });

  it('is said in words that are written', () => {
    expect(easeLevel(95)).toBe('veryEasy');
    expect(easeLevel(65)).toBe('plain');
    expect(easeLevel(10)).toBe('veryHard');
    for (const level of EASE_LEVELS) expect(texts[`scribe.stats.ease.${level}`], level).toBeTruthy();
  });
});

describe('the usual limits', () => {
  it('say how much room is left', () => {
    expect(against(100, 280)).toEqual({ left: 180, full: 100 / 280, state: 'ok' });
    expect(against(270, 280).state).toBe('near');
    expect(against(300, 280)).toEqual({ left: -20, full: 1, state: 'over' });
  });

  it('are each named', () => {
    for (const limit of LIMITS) expect(texts[`scribe.stats.limit.${limit.id}`], limit.id).toBeTruthy();
  });
});
