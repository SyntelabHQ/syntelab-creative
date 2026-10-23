import type { PlanPage } from '../document/page-plan';
import type { Mark } from '../marks/mark';

/** A word read off a page: what it says, and its box in points from the top-left corner of the page as it lies in its file. */
export interface ReadWord {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The names the engine gives languages (three letters, as ISO 639-2 has
 * them), for the languages of the program by their two letters. A language
 * not listed here is looked for under its own code.
 */
const ENGINE_NAMES: Record<string, string> = {
  ar: 'ara', bg: 'bul', cs: 'ces', da: 'dan', de: 'deu', el: 'ell', en: 'eng', es: 'spa', et: 'est', fi: 'fin', fr: 'fra', he: 'heb', hi: 'hin', hr: 'hrv', hu: 'hun',
  id: 'ind', it: 'ita', ja: 'jpn', ko: 'kor', lt: 'lit', lv: 'lav', nl: 'nld', no: 'nor', pl: 'pol', pt: 'por', ro: 'ron', ru: 'rus', sk: 'slk', sl: 'slv', sr: 'srp',
  sv: 'swe', th: 'tha', tr: 'tur', uk: 'ukr', vi: 'vie', zh: 'chi_sim',
};

/**
 * The languages to read in, to start with: what was chosen the last time, as
 * far as the engine still has it; else the language of the program and
 * English, as far as the engine has them; else the first it has.
 */
export function startLanguages(available: readonly string[], remembered: readonly string[], programLanguage: string): string[] {
  const kept = remembered.filter((language) => available.includes(language));
  if (kept.length > 0) return kept;
  const own = ENGINE_NAMES[programLanguage.slice(0, 2).toLowerCase()] ?? programLanguage;
  const usual = [...new Set([own, 'eng'])].filter((language) => available.includes(language));
  return usual.length > 0 ? usual : available.slice(0, 1);
}

/** The name of a language of the engine for the reader: `Romanian`, or its code when the system has no name for it. */
export function languageName(engineName: string, shownIn: string): string {
  // The system knows most languages by the engine's own three letters too; the rest keep the engine's name.
  const code = Object.entries(ENGINE_NAMES).find(([, name]) => name === engineName)?.[0] ?? (/^[a-z]{3}$/.test(engineName) ? engineName : undefined);
  if (!code) return engineName;
  try {
    return new Intl.DisplayNames([shownIn], { type: 'language' }).of(code) ?? engineName;
  } catch {
    return engineName;
  }
}

/** True for a page that already has text of its own worth keeping: a scan has none, or a few stray letters. */
export function hasText(text: string): boolean {
  return text.replace(/\s+/g, '').length >= 20;
}

/**
 * The words read off a page as a mark on it: text written into the page
 * unseen, so the page can be searched and its text copied. `turn` is how far
 * the page was turned to be read.
 */
export function hiddenTextMark(page: PlanPage, words: readonly ReadWord[], id: string): Mark {
  return { id, kind: 'hiddenText', x: 0, y: 0, width: page.width, height: page.height, rotation: 0, stroke: null, fill: null, opacity: 1, lineWidth: 1, words, turn: page.rotation };
}
