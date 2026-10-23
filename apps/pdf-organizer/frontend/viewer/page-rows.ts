import type { PageLayout } from './view-settings';

/** The pages shown side by side: one page, or two. */
export type PageRow = readonly number[];

/**
 * Groups page numbers into rows. With two pages per row and a cover page, the
 * first page stands alone and the pairs start at the second page.
 */
export function buildRows(pageCount: number, pageLayout: PageLayout, coverPage: boolean): PageRow[] {
  const rows: PageRow[] = [];
  if (pageLayout === 'single') {
    for (let page = 0; page < pageCount; page++) rows.push([page]);
    return rows;
  }
  let page = 0;
  if (coverPage && pageCount > 0) rows.push([page++]);
  for (; page < pageCount; page += 2) {
    rows.push(page + 1 < pageCount ? [page, page + 1] : [page]);
  }
  return rows;
}

/** The row a page is in, for rows made by `buildRows`. */
export function rowOfPage(page: number, pageLayout: PageLayout, coverPage: boolean): number {
  if (pageLayout === 'single') return page;
  return coverPage ? Math.ceil(page / 2) : Math.floor(page / 2);
}

export interface RowSizes {
  /** Sum of the page widths of each row, in PDF points. */
  readonly widths: Float64Array;
  /** Height of the tallest page of each row, in PDF points. */
  readonly heights: Float64Array;
  readonly widest: number;
  readonly tallest: number;
}

/** `pageSizes` is `[width0, height0, width1, height1, …]`. */
export function measureRows(rows: readonly PageRow[], pageSizes: readonly number[]): RowSizes {
  const widths = new Float64Array(rows.length);
  const heights = new Float64Array(rows.length);
  let widest = 0;
  let tallest = 0;
  rows.forEach((row, index) => {
    let width = 0;
    let height = 0;
    for (const page of row) {
      width += pageSizes[page * 2] ?? 0;
      height = Math.max(height, pageSizes[page * 2 + 1] ?? 0);
    }
    widths[index] = width;
    heights[index] = height;
    widest = Math.max(widest, width);
    tallest = Math.max(tallest, height);
  });
  return { widths, heights, widest, tallest };
}
