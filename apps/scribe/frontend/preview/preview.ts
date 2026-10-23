import type { AppHost } from '@syntelab/shell-api';

/**
 * What a tool would do to a text, as the Rust side tells it before it is
 * done (`preview`): the result, and how it differs from the text.
 */

/** How the result is set against the text. */
export type PreviewKind = 'same' | 'reordered' | 'inPlace' | 'removed' | 'rewritten';

/** What is said of one line of the result (lines are counted from 0). */
export type PreviewMark =
  | { readonly kind: 'changed'; readonly line: number; /** The stretches that differ, in UTF-16 units from the start of the line. */ readonly pieces: readonly (readonly [number, number])[] }
  | { readonly kind: 'moved'; readonly line: number; /** The line of the text it was (from 1). */ readonly from: number }
  | { readonly kind: 'added'; readonly line: number };

export interface Preview {
  readonly text: string;
  readonly kind: PreviewKind;
  readonly linesBefore: number;
  readonly linesAfter: number;
  readonly charactersBefore: number;
  readonly charactersAfter: number;
  readonly changedLines: number;
  readonly movedLines: number;
  readonly addedLines: number;
  readonly removedLines: number;
  /** The lines of the result that differ: the first few thousand of them. */
  readonly marks: readonly PreviewMark[];
  /** The lines of the text that are gone: their number (from 1) and what they said; the first thousand. */
  readonly removed: readonly { readonly line: number; readonly text: string }[];
}

/** Above this many characters nothing is shown beforehand: the text would be sent at every change of a choice. */
export const PREVIEW_UP_TO = 2_000_000;

export function fetchPreview(host: Pick<AppHost, 'invoke'>, text: string, operations: readonly Record<string, unknown>[]): Promise<Preview> {
  return host.invoke<Preview>('preview', { text, operations });
}

/** The facts worth saying about a result, in the order they are said: each a name (a key of the translations) and a number. */
export function factsOf(preview: Preview): { readonly key: string; readonly count: number }[] {
  const facts = [
    { key: 'changed', count: preview.changedLines },
    { key: 'moved', count: preview.movedLines },
    { key: 'added', count: preview.addedLines },
    { key: 'removed', count: preview.removedLines },
  ];
  return facts.filter((fact) => fact.count > 0);
}

/** The lines of the text (from 0) a result changes where they stand, and those it takes out: what is marked in the text itself. */
export function touchedLines(preview: Preview): { readonly changed: number[]; readonly removed: number[] } {
  // A line changed in place is the same line of the text; anywhere else the lines of the result are not those of the text.
  const changed = preview.kind === 'inPlace' ? preview.marks.filter((mark) => mark.kind === 'changed').map((mark) => mark.line) : [];
  return { changed, removed: preview.removed.map((line) => line.line - 1) };
}
