import { buildCatalog } from './catalog';
import type { MessageLoader } from './catalog';
import { directionOf, fallbackChain } from './languages';
import type { Direction, LanguageRegistry } from './languages';
import { createTranslator } from './translator';
import type { Translate } from './translator';

/** Everything the interface needs to show text in one language. */
export interface I18n {
  readonly language: string;
  readonly direction: Direction;
  /** Language → base language → source language. */
  readonly fallbackChain: readonly string[];
  readonly t: Translate;
  /** True when the key has a text in this language or one it falls back to. */
  readonly has: (key: string) => boolean;
  /** Same keys in the source language (English); used by command search. */
  readonly tSource: Translate;
}

export interface LoadI18nOptions {
  readonly language: string;
  readonly registry: LanguageRegistry;
  readonly loader: MessageLoader;
  readonly onMissing?: (key: string) => void;
}

export async function loadI18n(options: LoadI18nOptions): Promise<I18n> {
  const { language, registry, loader, onMissing } = options;
  const chain = fallbackChain(language, registry.source);
  const layers = await Promise.all(
    chain.map(async (layerLanguage) => ({
      language: layerLanguage,
      messages: await loader(layerLanguage),
    })),
  );
  const sourceLayers = layers.filter((layer) => layer.language === registry.source);

  const catalog = buildCatalog(layers);

  return {
    language,
    direction: directionOf(language, registry),
    fallbackChain: chain,
    t: createTranslator(catalog, onMissing),
    has: (key) => catalog.has(key),
    tSource: createTranslator(buildCatalog(sourceLayers)),
  };
}
