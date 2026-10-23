import { originOf } from './page-plan';
import type { PlanPage } from './page-plan';

/** One entry of a document's table of contents. */
export interface Bookmark {
  readonly title: string;
  /** The page of the file it leads to, from 0; null when it leads nowhere in the document. */
  readonly page: number | null;
  readonly children: readonly Bookmark[];
}

/** What `document_facts` answers: what a PDF says about itself. */
export interface DocumentFacts {
  readonly path: string;
  readonly fileSize: number;
  readonly title: string;
  readonly author: string;
  readonly subject: string;
  readonly keywords: string;
  readonly creator: string;
  readonly producer: string;
  /** As the file writes dates: `D:20261009143000+02'00'`. */
  readonly created: string;
  readonly modified: string;
  readonly format: string;
  readonly bookmarks: readonly Bookmark[];
}

/**
 * Reads a date the way PDFs write them (`D:YYYYMMDDHHmmSS+HH'mm'`, with
 * everything after the year optional). Null when it is not one.
 */
export function parsePdfDate(text: string): Date | null {
  const match = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*(?:(Z)|([+-])(\d{2})'?(\d{2})?'?)?/.exec(text.trim());
  if (!match) return null;
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00', utc, sign, offsetHours, offsetMinutes = '00'] = match;
  const zone = utc || !sign ? 'Z' : `${sign}${offsetHours}:${offsetMinutes}`;
  // Without a zone the time is taken as written, which is the best guess.
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Where a page of an open file is in the document as arranged now. Undefined
 * when the user removed it.
 */
export function planIndexOf(plan: readonly PlanPage[], documentId: number, page: number): number | undefined {
  const index = plan.findIndex((planned) => {
    const origin = originOf(planned);
    return origin.documentId === documentId && origin.page === page;
  });
  return index < 0 ? undefined : index;
}
