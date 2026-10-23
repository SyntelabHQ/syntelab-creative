import { IntlMessageFormat } from 'intl-messageformat';
import type { Catalog } from './catalog';

export type MessageValues = Readonly<Record<string, string | number | boolean | Date | null | undefined>>;

export type Translate = (key: string, values?: MessageValues) => string;

/**
 * Creates a lookup function over a catalog. Messages use ICU MessageFormat.
 * A key missing from the whole fallback chain is returned as is and reported
 * through `onMissing`; the translation checks in `tools/` are meant to catch it.
 */
export function createTranslator(catalog: Catalog, onMissing?: (key: string) => void): Translate {
  const formats = new Map<string, IntlMessageFormat | null>();

  const formatFor = (key: string): IntlMessageFormat | null => {
    const cached = formats.get(key);
    if (cached !== undefined) return cached;
    const entry = catalog.get(key);
    let format: IntlMessageFormat | null = null;
    if (entry) {
      try {
        format = new IntlMessageFormat(entry.text, entry.language, undefined, { ignoreTag: true });
      } catch {
        format = null;
      }
    }
    formats.set(key, format);
    return format;
  };

  return (key, values) => {
    const entry = catalog.get(key);
    if (!entry) {
      onMissing?.(key);
      return key;
    }
    const format = formatFor(key);
    if (!format) return entry.text;
    try {
      return String(format.format(values));
    } catch {
      return entry.text;
    }
  };
}
