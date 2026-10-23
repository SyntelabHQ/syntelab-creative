/** Which pages a change is for. */
export type PageRange =
  | { readonly kind: 'all' }
  /** The selected pages, or the page in view. */
  | { readonly kind: 'chosen' }
  /** Page numbers as people count them, from 1. */
  | { readonly kind: 'from-to'; readonly from: number; readonly to: number }
  /** Pages typed as a list: `1, 3, 5-8`. */
  | { readonly kind: 'custom'; readonly list: string };

/** Every page of the range, or only those with an odd or an even page number. */
export type Parity = 'both' | 'odd' | 'even';

/**
 * The places (from 0) of the pages in a list as people type one: numbers and
 * stretches, separated by commas, semicolons or spaces (`1, 3, 5-8`, `10-`
 * for "from 10 to the end"). In the order typed, each page once. `null` when
 * the list cannot be read; pages the document does not have are left out.
 */
export function parsePageList(list: string, count: number): number[] | null {
  const pages: number[] = [];
  const add = (number: number) => {
    if (number >= 1 && number <= count && !pages.includes(number - 1)) pages.push(number - 1);
  };
  for (const part of list.split(/[,;\s]+/).filter((piece) => piece !== '')) {
    const stretch = /^(\d+)?\s*[-–—]\s*(\d+)?$/.exec(part);
    if (stretch && (stretch[1] || stretch[2])) {
      const from = stretch[1] ? Number(stretch[1]) : 1;
      const to = stretch[2] ? Number(stretch[2]) : count;
      const step = from <= to ? 1 : -1;
      // A stretch far outside the document is cut to it before it is walked.
      const [first, last] = [Math.min(Math.max(from, 0), count + 1), Math.min(Math.max(to, 0), count + 1)];
      for (let number = first; step === 1 ? number <= last : number >= last; number += step) add(number);
    } else if (/^\d+$/.test(part)) add(Number(part));
    else return null;
  }
  return pages;
}

/**
 * The places (from 0) of the pages a change applies to, in a document of
 * `count` pages, in the order of the document. A list that cannot be read
 * gives none.
 */
export function pagesOf(range: PageRange, parity: Parity, count: number, chosen: ReadonlySet<number>): number[] {
  let pages: number[];
  if (range.kind === 'all') pages = Array.from({ length: count }, (_, index) => index);
  else if (range.kind === 'chosen') pages = [...chosen];
  else if (range.kind === 'custom') pages = parsePageList(range.list, count) ?? [];
  else {
    const first = Math.max(Math.min(range.from, range.to), 1);
    const last = Math.min(Math.max(range.from, range.to), count);
    pages = [];
    for (let number = first; number <= last; number++) pages.push(number - 1);
  }
  // People count pages from 1: the first page is odd.
  return pages.filter((index) => index >= 0 && index < count && (parity === 'both' || (parity === 'odd') === (index % 2 === 0))).sort((a, b) => a - b);
}
