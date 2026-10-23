import type { LocalizedText } from '@syntelab/shell-api';
import { createStore, useStore } from '../state/create-store';

// One file per language, `remote/creative/check/changelog/<language>.json`, as on the website.
const bundledFiles = import.meta.glob<unknown>('../../../remote/creative/check/changelog/*.json', { eager: true, import: 'default' });

/** One item of the changelog, with its texts in every language read so far. */
export interface ChangelogEntry {
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly title: LocalizedText;
  readonly body: LocalizedText;
  /** Optional web page with more, and the text of its link. */
  readonly link?: string;
  readonly linkLabel?: LocalizedText;
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * The usable items of the changelog file of one language, newest first. In
 * the file each text is plain; here it is filed under that language. Anything
 * malformed is left out.
 */
export function parseChangelog(file: unknown, language: string): ChangelogEntry[] {
  const items = typeof file === 'object' && file !== null ? (file as { items?: unknown }).items : undefined;
  if (!Array.isArray(items)) return [];
  const entries: ChangelogEntry[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, date, title, body, link, linkLabel } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof date !== 'string' || !isText(title) || !isText(body)) continue;
    if (link !== undefined && typeof link !== 'string') continue;
    entries.push({
      id,
      date,
      title: { [language]: title },
      body: { [language]: body },
      ...(typeof link === 'string' ? { link } : {}),
      ...(isText(linkLabel) ? { linkLabel: { [language]: linkLabel } } : {}),
    });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Joins two lists of items. An item present in both keeps the texts of both
 * (those of `newer` win for the same language) and the date and link of `newer`.
 */
export function mergeChangelogs(newer: readonly ChangelogEntry[], older: readonly ChangelogEntry[]): ChangelogEntry[] {
  const byId = new Map(older.map((entry) => [entry.id, entry]));
  for (const entry of newer) {
    const known = byId.get(entry.id);
    byId.set(
      entry.id,
      known
        ? {
            ...known,
            ...entry,
            title: { ...known.title, ...entry.title },
            body: { ...known.body, ...entry.body },
            ...(known.linkLabel || entry.linkLabel ? { linkLabel: { ...known.linkLabel, ...entry.linkLabel } } : {}),
          }
        : entry,
    );
  }
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
}

const shippedEntries = Object.entries(bundledFiles).reduce<ChangelogEntry[]>((all, [path, file]) => {
  const language = /([^/]+)\.json$/.exec(path)?.[1] ?? 'en';
  return mergeChangelogs(parseChangelog(file, language), all);
}, []);

/**
 * The changelog, newest first. It starts as the copy shipped with the program
 * and takes in the newer file from syntelab.com when that is read (updates/).
 */
const entries = createStore<readonly ChangelogEntry[]>(shippedEntries);

export function readChangelog(): readonly ChangelogEntry[] {
  return entries.get();
}

export function useChangelog(): readonly ChangelogEntry[] {
  return useStore(entries);
}

/** Takes in the changelog file of one language read from syntelab.com. */
export function receiveRemoteChangelog(file: unknown, language: string): void {
  const remote = parseChangelog(file, language);
  if (remote.length > 0) entries.set(mergeChangelogs(remote, shippedEntries));
}
