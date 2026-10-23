import { toPageGrid } from '../insert/watermark-marks';
import { TEXT_LINE_HEIGHT } from '../marks/mark';
import type { Mark } from '../marks/mark';
import type { PlanPage } from './page-plan';
import { PLACES } from './page-shape';
import type { Place } from './page-shape';

/**
 * Page numbers are text drawn on the pages like any other (see `marks/`):
 * real text in the file, in the font and color chosen, and still movable on
 * each page until the file is saved.
 */

/**
 * How a page number is written. `page` and `page-of` use words, in the
 * language of the program; `custom` is a text of the user's own, in which
 * `{number}` stands for the page's number and `{count}` for the last one.
 */
export const NUMBER_FORMATS = ['plain', 'of', 'dashes', 'page', 'page-of', 'custom'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export interface PageNumbering {
  readonly format: NumberFormat;
  /** The number of the document's first page. */
  readonly start: number;
  readonly place: Place;
  /** Height of the letters, in points. */
  readonly size: number;
  /** Distance from the edges of the page, in points. */
  readonly margin: number;
  /** `#rrggbb`. */
  readonly color: string;
  /** A built-in font, or the name of a font of the computer. */
  readonly font: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** The first page of the document (a cover) gets no number; the others keep theirs. */
  readonly skipFirst: boolean;
  /** The text of the `custom` format. */
  readonly custom: string;
}

export const DEFAULT_NUMBERING: PageNumbering = {
  format: 'plain',
  start: 1,
  place: 'bottom-right',
  size: 11,
  // 10 mm.
  margin: (72 / 25.4) * 10,
  color: '#000000',
  font: 'sans',
  bold: false,
  italic: false,
  skipFirst: false,
  custom: 'Page {number} of {count}',
};

export const NUMBER_PLACES = PLACES;
export const SMALLEST_NUMBER_SIZE = 4;
export const LARGEST_NUMBER_SIZE = 144;

/** The words of the formats that have some, already translated, with `{number}` and `{count}` to fill in. */
export interface NumberWords {
  readonly page: string;
  readonly pageOf: string;
}

/** One page's number: `3`, `3 / 12`, `– 3 –`, `Page 3`, `Page 3 of 12`. */
export function pageNumber(format: NumberFormat, number: number, last: number, words: NumberWords, custom = ''): string {
  if (format === 'of') return `${number} / ${last}`;
  if (format === 'dashes') return `– ${number} –`;
  const fill = (text: string) => text.split('{number}').join(String(number)).split('{count}').join(String(last));
  if (format === 'page') return fill(words.page);
  if (format === 'page-of') return fill(words.pageOf);
  if (format === 'custom') return fill(custom);
  return String(number);
}

/**
 * The number of the page at `index` (from 0) of a document of `pageCount`
 * pages, or null when it gets none. A page is numbered by its place in the
 * document, also when only some pages get a number.
 */
export function numberOfPage(numbering: PageNumbering, index: number, pageCount: number, words: NumberWords): string | null {
  if (numbering.skipFirst && index === 0) return null;
  const start = Math.max(0, Math.floor(numbering.start) || 0);
  return pageNumber(numbering.format, start + index, start + pageCount - 1, words, numbering.custom);
}

/**
 * The number as a mark on its page: at the chosen place as the reader sees
 * the page, whatever turn the user gave it. `fitted` gives a text mark the
 * size its text takes (see `measure-text.ts`).
 */
export function numberMark(page: PlanPage, text: string, numbering: PageNumbering, fitted: (mark: Mark) => Mark, id: string): Mark {
  const size = Math.min(Math.max(numbering.size || DEFAULT_NUMBERING.size, SMALLEST_NUMBER_SIZE), LARGEST_NUMBER_SIZE);
  const { color, font, bold, italic } = numbering;
  const sized = fitted({ id, kind: 'text', x: 0, y: 0, width: 0, height: 0, rotation: 0, stroke: color, fill: null, opacity: 1, lineWidth: 1, text, font, bold, italic, size });
  // A picture of text (a script the fonts cannot write) keeps the size it was drawn at.
  const [width, height] = [sized.width, sized.kind === 'text' ? size * TEXT_LINE_HEIGHT : sized.height];

  const sideways = page.rotation % 180 !== 0;
  const [shownWidth, shownHeight] = sideways ? [page.height, page.width] : [page.width, page.height];
  const margin = Math.max(0, numbering.margin || 0);
  const [down, across] = numbering.place.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  const left = across === 'left' ? margin : across === 'right' ? shownWidth - margin - width : (shownWidth - width) / 2;
  const top = down === 'top' ? margin : shownHeight - margin - height;
  const middle = toPageGrid({ x: left + width / 2, y: top + height / 2 }, page);
  return { ...sized, x: middle.x - width / 2, y: middle.y - height / 2, rotation: (360 - page.rotation) % 360 };
}
