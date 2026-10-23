import { DEFAULT_NUMBERING, numberMark } from '../document/page-numbers';
import type { PlanPage } from '../document/page-plan';
import { pagesOf } from '../document/page-range';
import type { PageRange, Parity } from '../document/page-range';
import { PLACES } from '../document/page-shape';
import type { Place } from '../document/page-shape';
import type { Mark } from '../marks/mark';

/**
 * A header and footer, or Bates numbers: text written at the edges of many
 * pages. Like page numbers, they are text marks (see `marks/`): real text in
 * the file, still movable on each page until it is saved.
 */

export type PageTextsMode = 'header-footer' | 'bates';

/** Numbers that tell the pages of a set of documents apart: a word before, a number of a fixed length, a word after. */
export interface Bates {
  readonly prefix: string;
  readonly suffix: string;
  /** The number of the first page that gets one. */
  readonly start: number;
  /** How many digits the number has at least; shorter ones get zeros in front. */
  readonly digits: number;
  readonly place: Place;
}

export interface PageTexts {
  readonly mode: PageTextsMode;
  /**
   * The text at each of the six places, for a header and footer. In it,
   * `{page}` stands for the page's number, `{pages}` for the number of pages,
   * `{date}` for today's date and `{file}` for the name of the document.
   */
  readonly texts: Readonly<Record<Place, string>>;
  readonly bates: Bates;
  /** Height of the letters, in points. */
  readonly size: number;
  /** Distance from the edges of the page, in points. */
  readonly margin: number;
  /** `#rrggbb`. */
  readonly color: string;
  readonly font: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly range: PageRange;
  readonly parity: Parity;
  /** The pages that were chosen (selected, or in view) when it started. */
  readonly chosen: ReadonlySet<number>;
}

const NO_TEXTS = Object.fromEntries(PLACES.map((place) => [place, ''])) as Record<Place, string>;

export const MOST_BATES_DIGITS = 12;

export function startPageTexts(mode: PageTextsMode, chosen: ReadonlySet<number>): PageTexts {
  return {
    mode,
    texts: NO_TEXTS,
    bates: { prefix: '', suffix: '', start: 1, digits: 6, place: 'bottom-right' },
    size: mode === 'bates' ? 10 : 9,
    margin: DEFAULT_NUMBERING.margin,
    color: '#000000',
    font: 'sans',
    bold: false,
    italic: false,
    range: { kind: 'all' },
    parity: 'both',
    chosen: new Set(chosen),
  };
}

/** What the words in braces stand for on one page. */
export interface PageFacts {
  readonly page: number;
  readonly pages: number;
  readonly date: string;
  readonly file: string;
}

/** The text with its words in braces filled in. */
export function filledText(text: string, facts: PageFacts): string {
  const values: Record<string, string> = { page: String(facts.page), pages: String(facts.pages), date: facts.date, file: facts.file };
  return text.replace(/\{(page|pages|date|file)\}/g, (_, word: string) => values[word] ?? '');
}

/** A Bates number: `ABC000012`. */
export function batesNumber(bates: Bates, order: number): string {
  const digits = Math.min(Math.max(Math.floor(bates.digits) || 1, 1), MOST_BATES_DIGITS);
  const number = Math.max(0, Math.floor(bates.start) || 0) + order;
  return `${bates.prefix}${String(number).padStart(digits, '0')}${bates.suffix}`;
}

/** The places (from 0) of the pages that get the texts. */
export function pagesWithTexts(settings: PageTexts, pageCount: number): number[] {
  return pagesOf(settings.range, settings.parity, pageCount, settings.chosen);
}

/**
 * The texts of the page at `index`, as marks on it. `today` and `file` fill
 * `{date}` and `{file}`; `fitted` gives a text mark the size its text takes;
 * the marks are named `id` and a number.
 */
export function pageTextMarks(settings: PageTexts, pages: readonly PlanPage[], index: number, today: string, file: string, fitted: (mark: Mark) => Mark, id: string): Mark[] {
  const page = pages[index];
  const stamped = pagesWithTexts(settings, pages.length);
  const order = stamped.indexOf(index);
  if (!page || order === -1) return [];
  const { size, margin, color, font, bold, italic } = settings;
  const look = { ...DEFAULT_NUMBERING, size, margin, color, font, bold, italic };
  const texts: [Place, string][] =
    settings.mode === 'bates'
      ? [[settings.bates.place, batesNumber(settings.bates, order)]]
      : PLACES.map((place) => [place, filledText(settings.texts[place], { page: index + 1, pages: pages.length, date: today, file })]);
  return texts.filter(([, text]) => text.trim() !== '').map(([place, text], number) => numberMark(page, text, { ...look, place }, fitted, `${id}-${number}`));
}
