import type { LanguageRegistry, MessageLoader, Messages } from '@syntelab/i18n';
import languages from '../../../locales/languages.json';

/** `locales/languages.json`: the planned languages, the source and the RTL list. */
export const languageRegistry: LanguageRegistry = languages;

type LazyMessages = () => Promise<Messages>;

// Global texts: locales/<lang>/common.json and shell.json.
const globalFiles = import.meta.glob<Messages>('../../../locales/*/*.json', { import: 'default' });
// App texts: apps/<app-id>/locales/<lang>.json.
const appFiles = import.meta.glob<Messages>('../../../apps/*/locales/*.json', { import: 'default' });

interface LocaleFile {
  /** Keys in the file must start with one of these (`common.`, `pdf-organizer.`…). */
  readonly namespaces: readonly string[];
  readonly load: LazyMessages;
}

function indexFiles(): Map<string, LocaleFile[]> {
  const byLanguage = new Map<string, LocaleFile[]>();
  const add = (language: string, file: LocaleFile) => {
    byLanguage.set(language, [...(byLanguage.get(language) ?? []), file]);
  };

  for (const [path, load] of Object.entries(globalFiles)) {
    const match = /\/locales\/([^/]+)\/[^/]+\.json$/.exec(path);
    if (match?.[1]) add(match[1], { namespaces: ['common.', 'shell.'], load });
  }
  for (const [path, load] of Object.entries(appFiles)) {
    const match = /\/apps\/([^/]+)\/locales\/([^/]+)\.json$/.exec(path);
    if (match?.[1] && match[2]) add(match[2], { namespaces: [`${match[1]}.`], load });
  }
  return byLanguage;
}

const filesByLanguage = indexFiles();

/**
 * Languages that can be chosen now: listed in `languages.json` and with global
 * translations present in `locales/<lang>/`.
 */
export const availableLanguages: readonly string[] = languageRegistry.languages
  .map((language) => language.code)
  .filter((code) => Object.keys(globalFiles).some((path) => path.includes(`/locales/${code}/`)));

/** Merges every file of one language, keeping only keys in the file's own namespace. */
export const loadMessages: MessageLoader = async (language) => {
  const files = filesByLanguage.get(language) ?? [];
  const loaded = await Promise.all(
    files.map(async ({ namespaces, load }) => {
      const messages = await load();
      return Object.entries(messages).filter(([key]) =>
        namespaces.some((namespace) => key.startsWith(namespace)),
      );
    }),
  );
  return Object.fromEntries(loaded.flat());
};
