import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useRef, useState } from 'react';
import type { PlanPage } from '../document/page-plan';

/** A link a page of the document has: where it is (points from the top-left corner of the page as it lies in its file) and where it leads. */
export interface PageLink {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** An address outside the document, or null. */
  readonly url: string | null;
  /** A page of the file, from 0, or null. */
  readonly page: number | null;
  /** Not a link but a signature shown there: its place in what `signatures` lists, or null. */
  readonly signature: number | null;
}

/** What `page_links` answers: the links of a page, and the boxes of the signatures shown on it. */
export interface PageLinksAnswer {
  readonly links: readonly Omit<PageLink, 'signature'>[];
  readonly signatures?: readonly { x: number; y: number; width: number; height: number; index: number }[];
}

/** Links and signatures together, the signatures first: a link drawn over a signature stays the one clicked. */
export function linksOfAnswer(answer: PageLinksAnswer): readonly PageLink[] {
  const signatures = (answer.signatures ?? []).map(({ x, y, width, height, index }) => ({ x, y, width, height, url: null, page: null, signature: index }));
  return [...signatures, ...answer.links.map((link) => ({ ...link, signature: null }))];
}

const NO_LINKS: readonly PageLink[] = [];

/** Addresses the program hands to the system to open: web pages and mail. Anything else (a file, a script) is not followed. */
export function canBeFollowed(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim());
}

/**
 * The links of the pages near the one in view, read from the file as they
 * come into view. Only pages that are still as they are in their file have
 * links to show: a page that was reshaped has them elsewhere.
 */
export function usePageLinks(host: Pick<AppHost, 'invoke'>, pages: readonly PlanPage[]): (page: PlanPage) => readonly PageLink[] {
  const { invoke } = host;
  const known = useRef(new Map<string, readonly PageLink[]>()).current;
  const [, setRead] = useState(0);

  useEffect(() => {
    let cancelled = false;
    for (const page of pages) {
      const key = `${page.documentId}:${page.page}`;
      if (page.origin || known.has(key)) continue;
      // Marked at once, so the same page is not asked for twice.
      known.set(key, NO_LINKS);
      void invoke<PageLinksAnswer>('page_links', { documentId: page.documentId, page: page.page }).then(
        (answer) => {
          const links = linksOfAnswer(answer);
          known.set(key, links);
          if (!cancelled && links.length > 0) setRead((count) => count + 1);
        },
        () => known.delete(key),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [invoke, pages]);
  return (page) => (page.origin ? NO_LINKS : (known.get(`${page.documentId}:${page.page}`) ?? NO_LINKS));
}
