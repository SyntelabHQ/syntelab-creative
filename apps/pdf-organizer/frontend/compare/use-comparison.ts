import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useState } from 'react';
import type { OpenedDocument } from '../document/use-document';
import { comparePages } from './compare-pages';
import type { PageComparison } from './compare-pages';

/** Pages whose text is asked for in one go. */
const STRETCH = 100;

export interface ComparedDocument {
  readonly documentId: number;
  readonly fileName: string;
  readonly pageSizes: readonly number[];
}

export type Comparison =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
      readonly status: 'ready';
      readonly first: ComparedDocument;
      readonly second: ComparedDocument;
      readonly pages: readonly PageComparison[];
    };

async function textsOf(host: AppHost, document: ComparedDocument): Promise<string[]> {
  const pageCount = document.pageSizes.length / 2;
  const texts: string[] = [];
  for (let fromPage = 0; fromPage < pageCount; fromPage += STRETCH) {
    const answer = await host.invoke<{ texts: readonly string[] }>('page_texts', {
      documentId: document.documentId,
      fromPage,
      pageCount: STRETCH,
    });
    texts.push(...answer.texts);
  }
  // A page that gave no answer counts as a page without text.
  while (texts.length < pageCount) texts.push('');
  return texts;
}

/** Opens two files and compares them page by page, by their text. Both are closed with the tab. */
export function useComparison(host: AppHost, firstPath: string, secondPath: string): Comparison {
  const [comparison, setComparison] = useState<Comparison>({ status: 'loading' });
  const { invoke } = host;

  useEffect(() => {
    let cancelled = false;
    const opened: number[] = [];
    const close = () => {
      for (const documentId of opened) void invoke('close_document', { documentId }).catch(() => {});
    };
    setComparison({ status: 'loading' });

    void (async () => {
      const open = async (path: string) => {
        const document = await invoke<OpenedDocument>('open_document', { path });
        opened.push(document.documentId);
        return document;
      };
      const first = await open(firstPath);
      const second = await open(secondPath);
      const pages = comparePages(await textsOf(host, first), await textsOf(host, second));
      if (cancelled) close();
      else setComparison({ status: 'ready', first, second, pages });
    })().catch(() => {
      if (!cancelled) setComparison({ status: 'error' });
    });

    return () => {
      cancelled = true;
      close();
    };
    // `host` itself changes when the tab moves to the back; its functions do not.
  }, [invoke, firstPath, secondPath]);

  return comparison;
}
