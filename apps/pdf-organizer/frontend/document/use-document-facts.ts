import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useState } from 'react';
import type { DocumentFacts } from './document-facts';

/**
 * What the open document says about itself (title, author, bookmarks…). Asked
 * once per document; null until the answer is there, and when it cannot be read.
 */
export function useDocumentFacts(host: AppHost, documentId: number | undefined): DocumentFacts | null {
  const [facts, setFacts] = useState<DocumentFacts | null>(null);
  const { invoke } = host;

  useEffect(() => {
    setFacts(null);
    if (documentId === undefined) return;
    let cancelled = false;
    invoke<DocumentFacts>('document_facts', { documentId }).then(
      (answer) => {
        if (!cancelled) setFacts(answer);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [invoke, documentId]);

  return facts;
}
