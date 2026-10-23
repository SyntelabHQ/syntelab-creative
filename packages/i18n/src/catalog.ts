/** Flat key → ICU message map, as stored in the locale JSON files. */
export type Messages = Readonly<Record<string, string>>;

/** Returns every message known for one language (global + app files merged). */
export type MessageLoader = (language: string) => Promise<Messages>;

export interface CatalogLayer {
  readonly language: string;
  readonly messages: Messages;
}

export interface CatalogEntry {
  readonly text: string;
  /** Language the text is written in; its plural rules apply when formatting. */
  readonly language: string;
}

export type Catalog = ReadonlyMap<string, CatalogEntry>;

/** Merges layers ordered from most to least preferred; the first one wins. */
export function buildCatalog(layers: readonly CatalogLayer[]): Catalog {
  const catalog = new Map<string, CatalogEntry>();
  for (const { language, messages } of layers) {
    for (const [key, text] of Object.entries(messages)) {
      if (!catalog.has(key)) catalog.set(key, { text, language });
    }
  }
  return catalog;
}
