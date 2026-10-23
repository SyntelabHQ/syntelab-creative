import type { LoadedPicture } from '../document/load-picture';
import type { PlanPage } from '../document/page-plan';
import { PLACES } from '../document/page-shape';
import type { Place } from '../document/page-shape';
import type { Mark } from '../marks/mark';
import { signatureLook } from '../sign/signature-look';

/** On which pages of each file the signature shows: none (it is in the file only), the first, the last, or every page. */
export const SIGN_PAGES = ['first', 'last', 'all', 'none'] as const;
export type SignPages = (typeof SIGN_PAGES)[number];

/**
 * Where the signature shows on a page, the same on every page and in every
 * file: its size in points, and where it lies in the room the page leaves
 * for it inside its margins, across and down, each from 0 (left, top) to 1
 * (right, bottom). Pages of other sizes keep the signature's size and its
 * place in proportion.
 */
export interface SignSpot {
  readonly across: number;
  readonly down: number;
  readonly width: number;
  readonly height: number;
}

/** What every signature of a run says and shows, beside who signs. */
export interface SignSettings {
  readonly reason: string;
  readonly location: string;
  readonly lock: boolean;
  readonly pages: SignPages;
  readonly spot: SignSpot;
}

/** The room a signature gets on a page when no one draws it, and the margin it keeps from the edges: in points. */
export const SIGNATURE_BOX = { width: 190, height: 64, margin: 28 };

/** A spot at one of the usual places, of the usual size. */
export function spotAt(place: Place): SignSpot {
  const [down, across] = place.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  return { across: across === 'left' ? 0 : across === 'right' ? 1 : 0.5, down: down === 'top' ? 0 : 1, width: SIGNATURE_BOX.width, height: SIGNATURE_BOX.height };
}

/** The usual place a spot is at, when it is at one of them and of the usual size. */
export function placeOf(spot: SignSpot): Place | null {
  return PLACES.find((place) => {
    const at = spotAt(place);
    return Math.abs(at.across - spot.across) < 0.01 && Math.abs(at.down - spot.down) < 0.01 && Math.abs(at.width - spot.width) < 1 && Math.abs(at.height - spot.height) < 1;
  }) ?? null;
}

/** Where a signature shows on a page of a size: a box from the page's top-left corner. */
export function spotBox(pageWidth: number, pageHeight: number, spot: SignSpot): { x: number; y: number; width: number; height: number } {
  const { margin } = SIGNATURE_BOX;
  const width = Math.min(spot.width, Math.max(pageWidth - 2 * margin, 20));
  const height = Math.min(spot.height, Math.max(pageHeight - 2 * margin, 10));
  const share = (value: number) => Math.min(Math.max(value, 0), 1);
  const x = margin + share(spot.across) * Math.max(pageWidth - 2 * margin - width, 0);
  const y = margin + share(spot.down) * Math.max(pageHeight - 2 * margin - height, 0);
  return { x: Math.max(Math.min(x, pageWidth - width), 0), y: Math.max(Math.min(y, pageHeight - height), 0), width, height };
}

/** The spot of a box drawn on a page of a size: the inverse of `spotBox`. */
export function spotOfBox(pageWidth: number, pageHeight: number, box: { x: number; y: number; width: number; height: number }): SignSpot {
  const { margin } = SIGNATURE_BOX;
  const freeAcross = pageWidth - 2 * margin - box.width;
  const freeDown = pageHeight - 2 * margin - box.height;
  const share = (value: number, free: number) => (free <= 0 ? 0.5 : Math.min(Math.max(value / free, 0), 1));
  return { across: share(box.x - margin, freeAcross), down: share(box.y - margin, freeDown), width: box.width, height: box.height };
}

/** The pages of a file of `count` pages the signature shows on, from 0. */
export function signedPages(pages: SignPages, count: number): number[] {
  if (count === 0 || pages === 'none') return [];
  if (pages === 'first') return [0];
  if (pages === 'last') return [count - 1];
  return Array.from({ length: count }, (_, index) => index);
}

/** Where a signature shows on the pages of one file: each page (from 0), the box on it, and what shows in the box (from its top-left corner). */
export interface SignaturePlace {
  readonly page: number;
  readonly box: { x: number; y: number; width: number; height: number };
  readonly look: Mark[];
}

/** The places a signature shows on the pages of one file, as settings say, with its picture and lines. */
export function signaturePlaces(settings: Pick<SignSettings, 'pages' | 'spot'>, pages: readonly PlanPage[], picture: LoadedPicture | null, lines: readonly string[], fitted: (mark: Mark) => Mark): SignaturePlace[] {
  return signedPages(settings.pages, pages.length).flatMap((index) => {
    const page = pages[index];
    if (!page) return [];
    const box = spotBox(page.width, page.height, settings.spot);
    return [{ page: index, box, look: signatureLook(box, page.rotation, picture, lines, fitted, `batch-signature-${index}`) }];
  });
}

/** The pages with the signature drawn on them where it shows: to see how it comes out before signing. */
export function withSignatureShown(pages: readonly PlanPage[], places: readonly SignaturePlace[]): PlanPage[] {
  return pages.map((page, index) => {
    const marks = places.filter((place) => place.page === index).flatMap((place) => place.look.map((mark) => ({ ...mark, x: mark.x + place.box.x, y: mark.y + place.box.y })));
    return marks.length === 0 ? page : { ...page, marks: [...(page.marks ?? []), ...marks] };
  });
}

export const DEFAULT_SIGN_SETTINGS: SignSettings = { reason: '', location: '', lock: false, pages: 'last', spot: spotAt('bottom-right') };

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Settings kept in a recipe, made whole; those kept before pages and spots ("visible", "onLastPage", "place") are read too. */
export function readSignSettings(stored: unknown): SignSettings {
  const saved = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const spot = saved.spot as Partial<SignSpot> | undefined;
  const pages = SIGN_PAGES.includes(saved.pages as SignPages)
    ? (saved.pages as SignPages)
    : saved.visible === false
      ? 'none'
      : saved.onLastPage === false
        ? 'first'
        : DEFAULT_SIGN_SETTINGS.pages;
  return {
    reason: text(saved.reason),
    location: text(saved.location),
    lock: saved.lock === true,
    pages,
    spot:
      spot && isNumber(spot.across) && isNumber(spot.down) && isNumber(spot.width) && isNumber(spot.height) && spot.width > 0 && spot.height > 0
        ? { across: spot.across, down: spot.down, width: spot.width, height: spot.height }
        : PLACES.includes(saved.place as Place)
          ? spotAt(saved.place as Place)
          : DEFAULT_SIGN_SETTINGS.spot,
  };
}
