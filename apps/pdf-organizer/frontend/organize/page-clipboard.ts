import { useSyncExternalStore } from 'react';
import type { PlanPage } from '../document/page-plan';

/**
 * The pages that were copied or cut, shared by every open document: they can
 * be pasted into the document they came from, or into another one.
 */
export interface CopiedPages {
  readonly pages: readonly PlanPage[];
  /** The document they were copied in, and where its file is: another document opens that file to take them. */
  readonly documentId: number;
  readonly path: string;
}

let copied: CopiedPages | null = null;
const listeners = new Set<() => void>();

export function copyPages(pages: CopiedPages | null): void {
  copied = pages && pages.pages.length > 0 ? pages : null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The pages copied last, in whichever document; null when none were. */
export function useCopiedPages(): CopiedPages | null {
  return useSyncExternalStore(subscribe, () => copied);
}

/**
 * The copied pages that another document can take: those of the file of the
 * document they were copied in, as they are in that file. A page that was
 * itself brought in from a third file stays behind, and what was drawn on a
 * page comes along.
 */
export function pagesForAnother(copied: CopiedPages, openedAs: number): PlanPage[] {
  return copied.pages.filter((page) => page.documentId === copied.documentId).map((page) => ({ ...page, documentId: openedAs }));
}
