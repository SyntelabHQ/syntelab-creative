/** How one page of the first document compares to the page with the same number in the second. */
export interface PageComparison {
  /** Page number, from 0. */
  readonly page: number;
  readonly status: 'same' | 'different' | 'only-first' | 'only-second';
  /** Lines the first document has and the second does not, in order. */
  readonly removed: readonly string[];
  /** Lines the second document has and the first does not, in order. */
  readonly added: readonly string[];
}

/** One line as it is compared: without the spacing differences that mean nothing. */
function normalize(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function linesOf(text: string): string[] {
  return text.split(/\r?\n/).map(normalize).filter((line) => line !== '');
}

/** The lines of `lines` that `other` does not have, counting repeats. */
function missingFrom(lines: readonly string[], other: readonly string[]): string[] {
  const available = new Map<string, number>();
  for (const line of other) available.set(line, (available.get(line) ?? 0) + 1);
  const missing: string[] = [];
  for (const line of lines) {
    const left = available.get(line) ?? 0;
    if (left > 0) available.set(line, left - 1);
    else missing.push(line);
  }
  return missing;
}

/**
 * Compares two documents page by page, by their text: page 1 with page 1,
 * and so on. Text that moved to another line on the same page is not a
 * difference; text that moved to another page is.
 */
export function comparePages(first: readonly string[], second: readonly string[]): PageComparison[] {
  const comparisons: PageComparison[] = [];
  for (let page = 0; page < Math.max(first.length, second.length); page++) {
    const firstText = first[page];
    const secondText = second[page];
    if (firstText === undefined || secondText === undefined) {
      const status = firstText === undefined ? 'only-second' : 'only-first';
      comparisons.push({ page, status, removed: linesOf(firstText ?? ''), added: linesOf(secondText ?? '') });
      continue;
    }
    const firstLines = linesOf(firstText);
    const secondLines = linesOf(secondText);
    const removed = missingFrom(firstLines, secondLines);
    const added = missingFrom(secondLines, firstLines);
    comparisons.push({ page, status: removed.length + added.length === 0 ? 'same' : 'different', removed, added });
  }
  return comparisons;
}

/** The next page that is not the same, going forward (1) or back (-1) from `page`, wrapping around. */
export function nextDifference(comparisons: readonly PageComparison[], page: number, direction: 1 | -1): number | null {
  const count = comparisons.length;
  for (let step = 1; step <= count; step++) {
    const candidate = (((page + direction * step) % count) + count) % count;
    if (comparisons[candidate]?.status !== 'same') return candidate;
  }
  return null;
}
