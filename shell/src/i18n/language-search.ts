import { normalize } from '@syntelab/command-registry';

/** One row of the language list. */
export interface LanguageOption {
  readonly code: string;
  /** The name in the language itself. */
  readonly native: string;
  /** The name in the language the program is shown in. */
  readonly translated: string;
  /** The English name, so a language can always be found by it. */
  readonly english: string;
  /** False for a planned language whose translation is not in this build. */
  readonly available: boolean;
}

/**
 * The languages whose code or one of whose names contains every word typed.
 * The order of the list is kept; an empty query keeps everything.
 */
export function searchLanguages(options: readonly LanguageOption[], query: string): LanguageOption[] {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...options];
  return options.filter((option) => {
    const haystack = normalize(`${option.code} ${option.native} ${option.translated} ${option.english}`);
    return words.every((word) => haystack.includes(word));
  });
}
