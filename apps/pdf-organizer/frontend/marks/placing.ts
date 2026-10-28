import type { QuarterTurns } from '../document/page-plan';
import { TEXT_LINE_HEIGHT } from './mark';
import type { Mark, Point } from './mark';

/**
 * Something chosen that still has to be put on a page: a picture (an image,
 * a drawn signature) or words (a typed signature). The user drags on the
 * page where it goes and how large; a click puts it there at a usual size.
 */
export type Placing = (
  | { readonly kind: 'picture'; readonly data: string; readonly width: number; readonly height: number }
  | { readonly kind: 'text'; readonly text: string; readonly font: string; readonly bold: boolean; readonly italic: boolean; readonly color: string }
  /** A box to drag: where a signature made with a certificate shows. */
  | { readonly kind: 'box' }
  /** A file to attach to the document: a paper clip marks where. */
  | { readonly kind: 'attachment'; readonly path: string; readonly name: string; readonly author: string }
) & {
  /** A date to write under it (a signature's), already written out. */
  readonly date?: string;
};

/** Sizes it gets from a click without a drag: the width of a picture, the letters of words, in points. */
const CLICK_WIDTH = 150;
const CLICK_TEXT_SIZE = 26;
/** The box of a signature made with a certificate, from a click without a drag, in points. */
const BOX_WIDTH = 200;
const BOX_HEIGHT = 60;
/** The paper clip that stands for an attached file, in points. */
const CLIP_WIDTH = 16;
const CLIP_HEIGHT = 22;
const SMALLEST_CLIP_HEIGHT = 11;
const LARGEST_CLIP_HEIGHT = 120;
/** A drag shorter than this, in points, counts as a click. */
const CLICK_DISTANCE = 4;
const SMALLEST_TEXT_SIZE = 5;
const LARGEST_TEXT_SIZE = 300;

/**
 * The marks that put it on the page, for a drag from `from` to `to` (in the
 * page's own grid) on a page shown turned by `turn`: it stands upright for
 * the reader, as wide as the drag (its shape is kept). `fitted` gives a text
 * mark the size its text takes; `newId` names the marks.
 */
export function placedMarks(placing: Placing, from: Point, to: Point, turn: QuarterTurns, fitted: (mark: Mark) => Mark, newId: () => string): Mark[] {
  const sideways = turn % 180 !== 0;
  // How far the drag went across and down, as the reader sees the page.
  const [across, down] = sideways ? [Math.abs(to.y - from.y), Math.abs(to.x - from.x)] : [Math.abs(to.x - from.x), Math.abs(to.y - from.y)];
  const clicked = Math.hypot(across, down) < CLICK_DISTANCE;
  const middle = clicked ? from : { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const rotation = (360 - turn) % 360;
  const base = { rotation, opacity: 1, lineWidth: 1, fill: null };

  let mark: Mark;
  if (placing.kind === 'box') {
    // As dragged; a click gives a box of a usual size around it.
    const dragged = Math.hypot(to.x - from.x, to.y - from.y) >= CLICK_DISTANCE;
    const [width, height] = dragged ? [Math.abs(to.x - from.x), Math.abs(to.y - from.y)] : sideways ? [BOX_HEIGHT, BOX_WIDTH] : [BOX_WIDTH, BOX_HEIGHT];
    const [x, y] = dragged ? [Math.min(from.x, to.x), Math.min(from.y, to.y)] : [from.x - width / 2, from.y - height / 2];
    return [{ ...base, rotation: 0, id: newId(), kind: 'signatureField', x, y, width, height, stroke: null }];
  }
  if (placing.kind === 'attachment') {
    // A paper clip as large as the drag (its shape kept); a click puts one of the usual size there.
    const height = clicked ? CLIP_HEIGHT : Math.min(Math.max(down, (across * CLIP_HEIGHT) / CLIP_WIDTH, SMALLEST_CLIP_HEIGHT), LARGEST_CLIP_HEIGHT);
    const width = (height * CLIP_WIDTH) / CLIP_HEIGHT;
    return [{ ...base, id: newId(), kind: 'attachment', x: middle.x - width / 2, y: middle.y - height / 2, width, height, stroke: null, name: placing.name, path: placing.path, author: placing.author }];
  }
  if (placing.kind === 'picture') {
    const shape = placing.height / Math.max(placing.width, 1);
    // As wide as the drag, or as tall as it when that is what limits it.
    const width = clicked ? Math.min(CLICK_WIDTH, placing.width) : Math.max(Math.min(across, down / shape || across), 8);
    mark = { ...base, id: newId(), kind: 'picture', x: middle.x - width / 2, y: middle.y - (width * shape) / 2, width, height: width * shape, stroke: null, data: placing.data };
  } else {
    const { text, font, bold, italic, color } = placing;
    const sample = fitted({ ...base, id: 'sample', kind: 'text', x: 0, y: 0, width: 0, height: 0, stroke: color, text, font, bold, italic, size: 100 });
    const size = clicked ? CLICK_TEXT_SIZE : Math.min(Math.max((across / Math.max(sample.width, 1)) * 100, SMALLEST_TEXT_SIZE), LARGEST_TEXT_SIZE);
    const sized = fitted({ ...sample, id: newId(), size: Math.round(size * 10) / 10 });
    mark = { ...sized, x: middle.x - sized.width / 2, y: middle.y - sized.height / 2 };
  }
  if (!placing.date) return [mark];

  // The date goes under it, in small plain letters, lined up with its left edge as the reader sees it.
  const size = Math.min(Math.max(mark.height * 0.22, 8), 14);
  const date = fitted({ ...base, id: newId(), kind: 'text', x: 0, y: 0, width: 0, height: 0, stroke: placing.kind === 'text' ? placing.color : '#000000', text: placing.date, font: 'sans', bold: false, italic: false, size });
  const gap = size * 0.3;
  // Offsets as shown (right, down), turned back into the page's own grid.
  const shown = { x: -(mark.width - date.width) / 2, y: mark.height / 2 + gap + (size * TEXT_LINE_HEIGHT) / 2 };
  const angle = (rotation * Math.PI) / 180;
  const offset = { x: shown.x * Math.cos(angle) - shown.y * Math.sin(angle), y: shown.x * Math.sin(angle) + shown.y * Math.cos(angle) };
  const markMiddle = { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 };
  return [mark, { ...date, x: markMiddle.x + offset.x - date.width / 2, y: markMiddle.y + offset.y - date.height / 2 }];
}
