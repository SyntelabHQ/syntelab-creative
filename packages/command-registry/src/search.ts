import type { Command } from './command';

/** Lowercase, without diacritics, so "setari" finds "Setări". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Finds, among things of any kind, those whose names contain every word of
 * the query. `namesOf` returns all the names a thing answers to. Those with a
 * name that starts with the query come first.
 */
export function searchItems<T>(items: readonly T[], query: string, namesOf: (item: T) => readonly string[]): T[] {
  const normalizedQuery = normalize(query).trim();
  if (!normalizedQuery) return [];
  const words = normalizedQuery.split(/\s+/);

  const matches: { item: T; rank: number }[] = [];
  for (const item of items) {
    const names = namesOf(item).map(normalize);
    const matching = names.filter((name) => words.every((word) => name.includes(word)));
    if (matching.length === 0) continue;
    matches.push({ item, rank: matching.some((name) => name.startsWith(normalizedQuery)) ? 0 : 1 });
  }
  return matches.sort((a, b) => a.rank - b.rank).map((match) => match.item);
}

/**
 * Finds commands whose labels contain every word of the query.
 * `labelsOf` returns all the names a command answers to (the translated name
 * and the English one). Commands whose label starts with the query come first.
 */
export function searchCommands(
  commands: readonly Command[],
  query: string,
  labelsOf: (command: Command) => readonly string[],
): Command[] {
  return searchItems(commands, query, labelsOf);
}
