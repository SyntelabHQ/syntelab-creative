import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useState } from 'react';
import type { PlanPage } from '../document/page-plan';
import type { Mark } from './mark';

/** One line of text a page of the document has, as the Rust side reads it (`text_lines`). */
export interface TextLine {
  readonly text: string;
  /** In points, from the top-left corner of the page as it lies in its file. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Height of the letters, in points. */
  readonly size: number;
  /** Red, green and blue from 0 to 1. */
  readonly color: readonly [number, number, number];
  readonly bold: boolean;
  readonly italic: boolean;
  /** `sans`, `serif` or `mono`. */
  readonly font: string;
}

const NO_LINES: readonly TextLine[] = [];
/** Lines already read, by `documentId:page`; a document's pages do not change while it is open. */
const known = new Map<string, readonly TextLine[]>();

/**
 * The lines of text of the pages shown, while `wanted` (the tool that edits
 * the document's own text is in use). Returns them by page key; a page whose
 * lines are not read yet has none.
 */
export function useTextLines(host: Pick<AppHost, 'invoke'>, pages: readonly PlanPage[], wanted: boolean): (page: PlanPage) => readonly TextLine[] {
  const [, setRead] = useState(0);
  const { invoke } = host;
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    for (const page of pages) {
      const key = `${page.documentId}:${page.page}`;
      if (known.has(key)) continue;
      // Marked at once, so the same page is not asked for twice.
      known.set(key, NO_LINES);
      void invoke<{ lines: TextLine[] }>('text_lines', { documentId: page.documentId, page: page.page }).then(
        (answer) => {
          known.set(key, answer.lines);
          if (!cancelled) setRead((count) => count + 1);
        },
        () => known.delete(key),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [invoke, pages, wanted]);
  return (page) => (wanted ? (known.get(`${page.documentId}:${page.page}`) ?? NO_LINES) : NO_LINES);
}

const hex = (part: number) =>
  Math.round(Math.min(Math.max(part, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');

/**
 * What rewriting a line takes: a mark that takes the line out of the file
 * (shown as blank paper over it until then), and the same words as a text
 * mark in its place, to be changed.
 */
export function rewriteLine(line: TextLine, id: string): { erase: Mark; text: Mark } {
  const base = { rotation: 0, opacity: 1, lineWidth: 1, fill: null };
  return {
    // A little wider than the letters, so nothing of them is left at the edges; not taller, so the lines beside it stay.
    erase: { ...base, id: `${id}-erase`, kind: 'erase', x: line.x - 1, y: line.y, width: line.width + 2, height: line.height, stroke: null },
    text: {
      ...base,
      id: `${id}-text`,
      kind: 'text',
      x: line.x,
      // The box of a line reaches a little above its letters; text marks are placed by the top of their line.
      y: line.y + (line.height - line.size * 1.25) / 2,
      width: line.width,
      height: line.height,
      stroke: `#${line.color.map(hex).join('')}`,
      text: line.text,
      font: line.font,
      bold: line.bold,
      italic: line.italic,
      size: Math.round(line.size * 10) / 10,
    },
  };
}

/** True for a line already taken out by a mark of the page: it is not offered again. */
export function isRewritten(line: TextLine, marks: readonly Mark[]): boolean {
  const [centerX, centerY] = [line.x + line.width / 2, line.y + line.height / 2];
  return marks.some((mark) => mark.kind === 'erase' && centerX >= mark.x && centerX <= mark.x + mark.width && centerY >= mark.y && centerY <= mark.y + mark.height);
}
