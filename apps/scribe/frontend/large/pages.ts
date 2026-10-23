/** How many lines of a large file are shown at once. */
export const PAGE_LINES = 500;

/** The page (from 0) a line (from 1) is on. */
export function pageOf(line: number): number {
  return Math.max(Math.floor((line - 1) / PAGE_LINES), 0);
}

/** How many pages a file of so many lines has: one at least, so an empty file has a page to show. */
export function pagesOf(lines: number): number {
  return Math.max(Math.ceil(lines / PAGE_LINES), 1);
}

/** The size of a file as people read it, in the numbers of a language: 1.4 GB, 512 MB, 3 KB. */
export function sizeText(bytes: number, language: string): string {
  const units = ['kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  try {
    return new Intl.NumberFormat(language, { style: 'unit', unit: units[unit], unitDisplay: 'short', maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
  } catch {
    return `${Math.round(value)} ${['KB', 'MB', 'GB', 'TB'][unit]}`;
  }
}
