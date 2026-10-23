import { useI18n } from '@syntelab/i18n';
import { localizeText } from '@syntelab/shell-api';
import type { AppEntry } from '@syntelab/shell-api';

export interface AppTexts {
  readonly name: (app: AppEntry) => string;
  readonly description: (app: AppEntry) => string;
}

/** An app's name and description from its manifest, in the current language. */
export function useAppTexts(): AppTexts {
  const { fallbackChain } = useI18n();
  return {
    name: (app) => localizeText(app.manifest.name, fallbackChain),
    description: (app) => localizeText(app.manifest.description, fallbackChain),
  };
}
