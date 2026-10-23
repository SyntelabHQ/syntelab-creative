/** One language of `locales/languages.json`. */
export interface LanguageInfo {
  readonly code: string;
  /** The language's name in the language itself. */
  readonly native: string;
  /** Its English name: the fallback when a system cannot translate the name. */
  readonly english: string;
}

/** Shape of `locales/languages.json`. */
export interface LanguageRegistry {
  readonly source: string;
  readonly rtl: readonly string[];
  /** Every planned language, in the order they are offered. */
  readonly languages: readonly LanguageInfo[];
}

export type Direction = 'ltr' | 'rtl';

/** `pt-BR` → `pt`. */
export function baseLanguage(language: string): string {
  return language.split('-')[0] ?? language;
}

export function directionOf(language: string, registry: LanguageRegistry): Direction {
  const isRtl = registry.rtl.includes(language) || registry.rtl.includes(baseLanguage(language));
  return isRtl ? 'rtl' : 'ltr';
}

/** Requested language → base language → source language, without duplicates. */
export function fallbackChain(language: string, source: string): string[] {
  return [...new Set([language, baseLanguage(language), source])];
}

/**
 * Picks the best available language for an ordered list of requested ones
 * (for example `navigator.languages`). Falls back to the source language.
 */
export function matchLanguage(
  requested: readonly string[],
  available: readonly string[],
  source: string,
): string {
  const byLowerCase = new Map(available.map((language) => [language.toLowerCase(), language]));
  for (const language of requested) {
    const match =
      byLowerCase.get(language.toLowerCase()) ??
      byLowerCase.get(baseLanguage(language).toLowerCase());
    if (match) return match;
  }
  return source;
}
