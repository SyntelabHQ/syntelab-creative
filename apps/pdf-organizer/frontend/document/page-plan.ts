import { markRequest } from '../marks/mark';
import type { Mark } from '../marks/mark';

/** Degrees clockwise. */
export type QuarterTurns = 0 | 90 | 180 | 270;

/**
 * One page of the document as the user has arranged it. Organizing pages
 * changes this list only; the files on disk are untouched until the user
 * saves, and then a new file is written from the list.
 */
export interface PlanPage {
  /** Stays with the page while it moves, so its picture is not loaded again. */
  readonly key: string;
  /** The open document the page comes from (pages of other files can be inserted). */
  readonly documentId: number;
  /** Page number in that document, from 0. */
  readonly page: number;
  /** The turn the user gave the page, on top of the one it has in the file. */
  readonly rotation: QuarterTurns;
  /** Size in the file, in PDF points, before `rotation`. */
  readonly width: number;
  readonly height: number;
  /**
   * For a page that came back changed from the Rust side (cropped, numbered…):
   * the page of an opened file it was made from, so that what points at that
   * page (a bookmark) still finds it.
   */
  readonly origin?: PageOrigin;
  /**
   * What the user drew and wrote on the page. They stay objects that can be
   * changed until a file is written; then they become part of the page.
   */
  readonly marks?: readonly Mark[];
}

/** A page of an open file. */
export interface PageOrigin {
  readonly documentId: number;
  readonly page: number;
}

/** The page of an opened file a plan page is, or was made from. */
export function originOf(page: PlanPage): PageOrigin {
  return page.origin ?? { documentId: page.documentId, page: page.page };
}

/** `pageSizes` is `[width0, height0, width1, height1, …]`, as the Rust side sends it. */
export function planFromDocument(documentId: number, pageSizes: readonly number[]): PlanPage[] {
  const pages: PlanPage[] = [];
  for (let page = 0; page * 2 + 1 < pageSizes.length; page++) {
    pages.push({
      key: `${documentId}:${page}`,
      documentId,
      page,
      rotation: 0,
      width: pageSizes[page * 2] ?? 0,
      height: pageSizes[page * 2 + 1] ?? 0,
    });
  }
  return pages;
}

export function addTurns(rotation: QuarterTurns, degrees: number): QuarterTurns {
  return ((((rotation + degrees) % 360) + 360) % 360) as QuarterTurns;
}

/** Sizes as shown, `[width0, height0, …]`: each page's own turn plus the turn of the whole view. */
export function shownSizes(plan: readonly PlanPage[], viewRotation: QuarterTurns): number[] {
  const sizes = new Array<number>(plan.length * 2);
  plan.forEach((page, index) => {
    const sideways = addTurns(page.rotation, viewRotation) % 180 !== 0;
    sizes[index * 2] = sideways ? page.height : page.width;
    sizes[index * 2 + 1] = sideways ? page.width : page.height;
  });
  return sizes;
}

/** Turns the chosen pages a quarter left (-90) or right (90). */
export function rotatePages(plan: readonly PlanPage[], chosen: ReadonlySet<number>, degrees: 90 | -90): PlanPage[] {
  return plan.map((page, index) => (chosen.has(index) ? { ...page, rotation: addTurns(page.rotation, degrees) } : page));
}

/** Removes the chosen pages. A document keeps at least one page: removing all does nothing. */
export function deletePages(plan: readonly PlanPage[], chosen: ReadonlySet<number>): PlanPage[] {
  const kept = plan.filter((_, index) => !chosen.has(index));
  return kept.length === 0 ? [...plan] : kept;
}

export interface MovedPages {
  readonly plan: PlanPage[];
  /** Where the moved pages are now. */
  readonly chosen: Set<number>;
}

/**
 * Moves the chosen pages, keeping their order, so that they come just before
 * the page that is at `before` now (`plan.length` moves them to the end).
 */
export function movePages(plan: readonly PlanPage[], chosen: ReadonlySet<number>, before: number): MovedPages {
  const moving = plan.filter((_, index) => chosen.has(index));
  const staying = plan.filter((_, index) => !chosen.has(index));
  // The target counts only the pages that stay.
  let target = 0;
  for (let index = 0; index < Math.min(before, plan.length); index++) if (!chosen.has(index)) target++;
  const next = [...staying.slice(0, target), ...moving, ...staying.slice(target)];
  return { plan: next, chosen: new Set(moving.map((_, offset) => target + offset)) };
}

/** Puts `pages` into the plan so that the first of them lands at index `at`. */
export function insertPages(plan: readonly PlanPage[], at: number, pages: readonly PlanPage[]): PlanPage[] {
  const position = Math.min(Math.max(at, 0), plan.length);
  return [...plan.slice(0, position), ...pages, ...plan.slice(position)];
}

export interface ReplacedPages {
  readonly plan: PlanPage[];
  /** Where the pages that came in are now. */
  readonly chosen: Set<number>;
}

/**
 * Takes the chosen pages out and puts `pages` where the first of them was.
 * With nothing chosen, or nothing to put in, the plan stays as it is.
 */
export function replacePages(
  plan: readonly PlanPage[],
  chosen: ReadonlySet<number>,
  pages: readonly PlanPage[],
): ReplacedPages {
  const inPlan = [...chosen].filter((index) => index >= 0 && index < plan.length);
  if (inPlan.length === 0 || pages.length === 0) return { plan: [...plan], chosen: new Set() };
  // Every page before the first chosen one stays, so its index is the place.
  const at = Math.min(...inPlan);
  const kept = plan.filter((_, index) => !chosen.has(index));
  return {
    plan: [...kept.slice(0, at), ...pages, ...kept.slice(at)],
    chosen: new Set(pages.map((_, offset) => at + offset)),
  };
}

/**
 * Puts `pages` in the place of the pages at `indexes`, one for one, in
 * order. Used when pages come back from the Rust side in a new shape.
 */
export function swapPages(plan: readonly PlanPage[], indexes: readonly number[], pages: readonly PlanPage[]): PlanPage[] {
  const next = [...plan];
  indexes.forEach((index, order) => {
    const page = pages[order];
    const replaced = next[index];
    if (page && replaced) next[index] = { ...page, origin: originOf(replaced) };
  });
  return next;
}

/** Indexes of every second page: the 1st, 3rd… (`odd`) or the 2nd, 4th… (`even`), as people count pages. */
export function everySecondPage(count: number, which: 'odd' | 'even'): Set<number> {
  const chosen = new Set<number>();
  for (let index = which === 'odd' ? 0 : 1; index < count; index += 2) chosen.add(index);
  return chosen;
}

export function samePlan(a: readonly PlanPage[], b: readonly PlanPage[]): boolean {
  return a.length === b.length && a.every((page, index) => page.key === b[index]?.key && page.rotation === b[index]?.rotation && page.marks === b[index]?.marks);
}

/**
 * The same plan after the document `from` was reopened as `to` (its id
 * changed, its pages did not).
 */
export function withDocumentId(plan: readonly PlanPage[], from: number, to: number): PlanPage[] {
  return plan.map((page) => (page.documentId === from ? { ...page, documentId: to, key: `${to}:${page.page}` } : page));
}

/** One page as the Rust side takes it (`save_pages` and the commands like it). */
export interface RequestedPage {
  readonly documentId: number;
  readonly page: number;
  readonly rotation: number;
  /** Answers for the form fields on the page. */
  readonly answers?: readonly { readonly id: number; readonly value: string }[];
  /** What was drawn on the page; see `marks/mark.ts`. */
  readonly marks?: readonly Record<string, unknown>[];
}

/**
 * What the Rust side needs to write the plan as a file. `answersFor` gives
 * the form answers that go with a page, when the document has a form.
 */
export function planRequest(
  plan: readonly PlanPage[],
  answersFor?: (page: PlanPage) => readonly { id: number; value: string }[],
): RequestedPage[] {
  // A picture on many pages (a watermark) is sent with the first mark that has it; the others name it.
  const pictureIds = new Map<string, number>();
  const request = (mark: Mark): Record<string, unknown> => {
    const asked = markRequest(mark);
    if (mark.kind === 'link' && mark.toPageKey !== undefined) {
      // A link to a page: where that page is now. A page that is gone leaves no link.
      const toPage = plan.findIndex((page) => page.key === mark.toPageKey);
      return toPage === -1 ? { ...asked, url: '' } : { ...asked, toPage };
    }
    if (mark.kind !== 'picture' || typeof asked.data !== 'string') return asked;
    const known = pictureIds.get(asked.data);
    if (known !== undefined) return { ...asked, data: '', dataId: known };
    pictureIds.set(asked.data, pictureIds.size + 1);
    return { ...asked, dataId: pictureIds.size };
  };
  return plan.map((planned) => {
    const { documentId, page, rotation } = planned;
    const answers = answersFor?.(planned) ?? [];
    return {
      documentId,
      page,
      rotation,
      ...(answers.length > 0 ? { answers } : {}),
      ...(planned.marks && planned.marks.length > 0 ? { marks: planned.marks.map(request) } : {}),
    };
  });
}

/** The plan with the marks of the page that has `pageKey` replaced. */
export function withMarks(plan: readonly PlanPage[], pageKey: string, marks: readonly Mark[]): PlanPage[] {
  return plan.map((page) => {
    if (page.key !== pageKey) return page;
    const { marks: _before, ...rest } = page;
    return marks.length > 0 ? { ...rest, marks } : rest;
  });
}
