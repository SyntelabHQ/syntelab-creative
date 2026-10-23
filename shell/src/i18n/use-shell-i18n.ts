import { loadI18n } from '@syntelab/i18n';
import type { I18n } from '@syntelab/i18n';
import { useEffect, useState } from 'react';
import { SYSTEM_LANGUAGE, systemLanguage } from './language-names';
import { availableLanguages, languageRegistry, loadMessages } from './locale-files';

/** The language shown for a preference: the one chosen, or the system's. */
export function resolveLanguage(preference: string): string {
  if (preference !== SYSTEM_LANGUAGE && availableLanguages.includes(preference)) return preference;
  return systemLanguage();
}

function reportMissingKey(key: string): void {
  if (import.meta.env.DEV) console.warn(`[i18n] missing translation key: ${key}`);
}

/**
 * Loads the texts for the chosen language and keeps `<html lang dir>` in
 * sync. Returns null until the first language is ready; on a later switch the
 * previous language stays on screen until the new one has loaded.
 */
export function useShellI18n(languagePreference: string): I18n | null {
  const [i18n, setI18n] = useState<I18n | null>(null);
  const language = resolveLanguage(languagePreference);

  useEffect(() => {
    let cancelled = false;
    void loadI18n({
      language,
      registry: languageRegistry,
      loader: loadMessages,
      onMissing: reportMissingKey,
    }).then((loaded) => {
      if (cancelled) return;
      document.documentElement.lang = loaded.language;
      document.documentElement.dir = loaded.direction;
      setI18n(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return i18n;
}
