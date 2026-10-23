import { AppInvokeError } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rememberFile } from './recent-files';

/** An open PDF, as the Rust side describes it. */
export interface PdfDocument {
  readonly id: number;
  readonly fileName: string;
  readonly pageCount: number;
  /** `[width0, height0, width1, height1, …]` in PDF points (1/72 inch). */
  readonly pageSizes: readonly number[];
}

export type DocumentState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly document: PdfDocument }
  | { readonly status: 'error'; readonly messageKey: string };

/** What the Rust side answers when it opens (or reopens) a document. */
export interface OpenedDocument {
  readonly documentId: number;
  readonly fileName: string;
  readonly pageSizes: readonly number[];
}

export interface DocumentHandle {
  readonly state: DocumentState;
  /**
   * The Rust side closed the document and opened the file again (after saving
   * over it): carry on with the new one.
   */
  readonly replace: (opened: OpenedDocument) => PdfDocument;
}

function toDocument({ documentId, fileName, pageSizes }: OpenedDocument): PdfDocument {
  return { id: documentId, fileName, pageCount: pageSizes.length / 2, pageSizes };
}

function errorKey(error: unknown): string {
  if (error instanceof AppInvokeError) {
    if (error.kind === 'unavailable') return 'pdf-organizer.error.desktopOnly';
    if (error.code === 'password-required') return 'pdf-organizer.error.passwordRequired';
    if (error.code === 'cannot-open') return 'pdf-organizer.error.cannotOpen';
  }
  return 'pdf-organizer.error.unknown';
}

/**
 * Opens the file for as long as the component lives, and closes it after.
 * `remember` is false for a file of the program's own (an unsaved document),
 * which has no place among the recent files.
 */
export function useDocument(host: AppHost, path: string, remember = true): DocumentHandle {
  const [state, setState] = useState<DocumentState>({ status: 'loading' });
  /** The id to close when the tab goes away. */
  const opened = useRef<number | null>(null);
  const { invoke } = host;

  useEffect(() => {
    let cancelled = false;
    const close = (documentId: number) => void invoke('close_document', { documentId }).catch(() => {});

    setState({ status: 'loading' });
    invoke<OpenedDocument>('open_document', { path }).then(
      (answer) => {
        // The tab was closed while the file was opening.
        if (cancelled) return close(answer.documentId);
        opened.current = answer.documentId;
        if (remember) rememberFile(host, path);
        setState({ status: 'ready', document: toDocument(answer) });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', messageKey: errorKey(error) });
      },
    );

    return () => {
      cancelled = true;
      if (opened.current !== null) close(opened.current);
      opened.current = null;
    };
    // `host` itself changes when the tab moves to the back; its functions do not.
  }, [invoke, path]);

  const replace = useCallback((answer: OpenedDocument) => {
    const document = toDocument(answer);
    opened.current = document.id;
    setState({ status: 'ready', document });
    return document;
  }, []);

  return { state, replace };
}
