import { matchLanguage } from '@syntelab/i18n';
import type { I18n } from '@syntelab/i18n';
import { availableLanguages, languageRegistry } from './locale-files';

/** Language choice meaning "follow the system". */
export const SYSTEM_LANGUAGE = 'system';

/** The system language, narrowed to one the program can show. */
export function systemLanguage(): string {
  return matchLanguage(navigator.languages, availableLanguages, languageRegistry.source);
}

const info = new Map(languageRegistry.languages.map((language) => [language.code, language]));

/**
 * Codes the system names better under another code: the two kinds of Chinese
 * are told apart by their writing ("Simplified"), not by a country.
 */
const NAMED_AS: Readonly<Record<string, string>> = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant' };

/** A language's name written in that language ("Română", "العربية"). */
export function languageName(code: string): string {
  return info.get(code)?.native ?? code;
}

/**
 * A language's name in another language ("Romanian", "Rumänisch"…), for the
 * line under its own name. Falls back to the English name where the system
 * cannot translate it.
 */
function languageNameIn(code: string, displayLanguage: string): string {
  const english = info.get(code)?.english ?? code;
  if (displayLanguage === languageRegistry.source) return english;
  try {
    const namedAs = NAMED_AS[code] ?? code;
    const name = new Intl.DisplayNames([displayLanguage], { type: 'language' }).of(namedAs);
    // An untranslatable name comes back as the code itself.
    if (name && name.toLowerCase() !== namedAs.toLowerCase()) {
      return name.charAt(0).toLocaleUpperCase(displayLanguage) + name.slice(1);
    }
  } catch {
    // Unknown to this system's language data.
  }
  return english;
}

/**
 * A language's name in the language the program is shown in. A translation
 * file can set it with the key `common.language.<code>`; without one, the
 * name comes from the system's language data.
 */
export function translatedLanguageName(code: string, i18n: Pick<I18n, 'language' | 'has' | 't'>): string {
  const key = `common.language.${code}`;
  return i18n.has(key) ? i18n.t(key) : languageNameIn(code, i18n.language);
}
