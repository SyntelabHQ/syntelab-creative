import { parseManual, SHELL_MANUAL } from './manual';
import type { Manual } from './manual';

type LazyFile = () => Promise<unknown>;

// The manual of the program as a whole: help/shell/<lang>.json.
const shellFiles = import.meta.glob<unknown>('../../../help/shell/*.json', { import: 'default' });
// The manual of each app: apps/<app-id>/help/<lang>.json.
const appFiles = import.meta.glob<unknown>('../../../apps/*/help/*.json', { import: 'default' });

/** Every manual file, by manual and then by language. */
function indexFiles(): Map<string, Map<string, LazyFile>> {
  const byManual = new Map<string, Map<string, LazyFile>>();
  const add = (manual: string, language: string, load: LazyFile) => {
    const languages = byManual.get(manual) ?? new Map<string, LazyFile>();
    byManual.set(manual, languages.set(language, load));
  };
  for (const [path, load] of Object.entries(shellFiles)) {
    const match = /\/help\/shell\/([^/]+)\.json$/.exec(path);
    if (match?.[1]) add(SHELL_MANUAL, match[1], load);
  }
  for (const [path, load] of Object.entries(appFiles)) {
    const match = /\/apps\/([^/]+)\/help\/([^/]+)\.json$/.exec(path);
    if (match?.[1] && match[2]) add(match[1], match[2], load);
  }
  return byManual;
}

const files = indexFiles();

/**
 * The manuals in the first language of `languages` each one is written in
 * (the language of the program, what it falls back to, English). The
 * program's own manual comes first, then those of the apps.
 */
export async function loadManuals(languages: readonly string[]): Promise<Manual[]> {
  const ids = [...files.keys()].sort((one, other) => Number(other === SHELL_MANUAL) - Number(one === SHELL_MANUAL) || one.localeCompare(other));
  const loaded = await Promise.all(
    ids.map(async (id) => {
      const written = files.get(id);
      const language = languages.find((known) => written?.has(known));
      const load = language ? written?.get(language) : undefined;
      return load ? parseManual(id, await load().catch(() => null)) : null;
    }),
  );
  return loaded.filter((manual): manual is Manual => manual !== null);
}
