/**
 * How easy a text is to read, by the formulas that exist for it: each made
 * for one language, from how long its sentences and its words are. They
 * give a number from 0 (very hard) to 100 (very easy). A language without a
 * formula of its own gets none: a formula made for another would mislead.
 */

/** What a formula is worked out from. */
export interface ReadabilityFacts {
  readonly words: number;
  readonly sentences: number;
  readonly syllables: number;
}

/** A formula: the score falls as sentences get longer (`perSentence`) and as words do (`perSyllable`). */
interface Formula {
  readonly base: number;
  readonly perSentence: number;
  readonly perSyllable: number;
}

/** The formulas, by the code of their language: Flesch (en), Amstad (de), Fernández Huerta (es), Kandel–Moles (fr), Flesch–Vacca (it), Douma (nl), Martins and others (pt), Oborneva (ru). */
const FORMULAS: Readonly<Record<string, Formula>> = {
  en: { base: 206.835, perSentence: 1.015, perSyllable: 84.6 },
  de: { base: 180, perSentence: 1, perSyllable: 58.5 },
  es: { base: 206.84, perSentence: 1.02, perSyllable: 60 },
  fr: { base: 207, perSentence: 1.015, perSyllable: 73.6 },
  it: { base: 206, perSentence: 1, perSyllable: 65 },
  nl: { base: 206.84, perSentence: 0.93, perSyllable: 77 },
  pt: { base: 248.835, perSentence: 1.015, perSyllable: 84.6 },
  ru: { base: 206.835, perSentence: 1.3, perSyllable: 60.1 },
};

/** The languages that have a formula. */
export const READABILITY_LANGUAGES: readonly string[] = Object.keys(FORMULAS);

/** The language a formula is taken for: the one given when it has a formula (`pt-BR` is `pt`), else none. */
export function formulaLanguage(language: string): string | null {
  const code = language.toLowerCase().split(/[-_]/)[0] ?? '';
  return code in FORMULAS ? code : null;
}

/** The score of a text, from 0 to 100; null when the language has no formula or the text has no sentence. */
export function readingEase(facts: ReadabilityFacts, language: string): number | null {
  const formula = FORMULAS[formulaLanguage(language) ?? ''];
  if (!formula || facts.words === 0 || facts.sentences === 0) return null;
  const score = formula.base - formula.perSentence * (facts.words / facts.sentences) - formula.perSyllable * (facts.syllables / facts.words);
  return Math.min(Math.max(score, 0), 100);
}

/** How a score is said in words, from the easiest to the hardest. */
export const EASE_LEVELS = ['veryEasy', 'easy', 'fairlyEasy', 'plain', 'fairlyHard', 'hard', 'veryHard'] as const;
export type EaseLevel = (typeof EASE_LEVELS)[number];

/** The level a score is at: the bands Flesch gave, used for all the formulas made after his. */
export function easeLevel(score: number): EaseLevel {
  if (score >= 90) return 'veryEasy';
  if (score >= 80) return 'easy';
  if (score >= 70) return 'fairlyEasy';
  if (score >= 60) return 'plain';
  if (score >= 50) return 'fairlyHard';
  if (score >= 30) return 'hard';
  return 'veryHard';
}
