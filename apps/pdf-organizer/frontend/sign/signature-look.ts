import type { LoadedPicture } from '../document/load-picture';
import type { PlanPage, QuarterTurns } from '../document/page-plan';
import { toPageGrid } from '../insert/watermark-marks';
import { TEXT_LINE_HEIGHT } from '../marks/mark';
import type { Mark } from '../marks/mark';

/** The letters of a signature made with a certificate, where it shows. */
const COLOR = '#000000';
const SMALLEST_LETTERS = 3;
const LARGEST_LETTERS = 28;

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * What shows of a signature made with a certificate, as marks placed in its
 * box (from the box's top-left corner): a picture at the left and the lines
 * at the right, or either alone filling the box. The Rust side draws them as
 * the picture of the signature's own field. On a page shown turned by
 * `turn`, everything stands upright for the reader. `fitted` gives a text
 * mark the size its text takes; the marks are named `id`.
 */
export function signatureLook(box: Size, turn: QuarterTurns, picture: LoadedPicture | null, lines: readonly string[], fitted: (mark: Mark) => Mark, id: string): Mark[] {
  const text = lines.filter((line) => line.trim() !== '').join('\n');
  // The room as the reader sees it: lying on its side when the page is shown a quarter turned.
  const sideways = turn % 180 !== 0;
  const room = sideways ? { width: box.height, height: box.width } : box;
  // The box as a little page of its own, turned like the page it is on: places the reader sees are found in it.
  const asPage: PlanPage = { key: id, documentId: 0, page: 0, rotation: turn, width: box.width, height: box.height };
  const rotation = (360 - turn) % 360;
  const base = { rotation, opacity: 1, lineWidth: 1, fill: null };
  /** A mark of `width` × `height` with its middle at a place of the room. */
  const at = <T extends Mark>(mark: T, middle: { x: number; y: number }): T => {
    const inBox = toPageGrid(middle, asPage);
    return { ...mark, x: inBox.x - mark.width / 2, y: inBox.y - mark.height / 2 };
  };

  const marks: Mark[] = [];
  const edge = Math.min(room.height * 0.06, 4);
  // With both, the picture takes the width it needs at the full height (at most half), and the text the rest.
  const pictureWidth = picture ? (text === '' ? room.width : Math.min(room.width / 2, (picture.width / Math.max(picture.height, 1)) * (room.height - 2 * edge) + 2 * edge)) : 0;
  const pictureRoom = picture ? { x: 0, width: pictureWidth } : null;
  const textRoom = text === '' ? null : { x: pictureWidth, width: room.width - pictureWidth };

  if (picture && pictureRoom) {
    const scale = Math.min((pictureRoom.width - 2 * edge) / Math.max(picture.width, 1), (room.height - 2 * edge) / Math.max(picture.height, 1));
    const [width, height] = [picture.width * scale, picture.height * scale];
    if (width > 0 && height > 0) {
      marks.push(at({ ...base, id: `${id}-picture`, kind: 'picture', x: 0, y: 0, width, height, stroke: null, data: picture.address }, { x: pictureRoom.x + pictureRoom.width / 2, y: room.height / 2 }));
    }
  }
  if (textRoom) {
    const letters = (lines: string, size: number): Mark => fitted({ ...base, id: `${id}-text`, kind: 'text', x: 0, y: 0, width: 0, height: 0, stroke: COLOR, text: lines, font: 'sans', bold: false, italic: false, size });
    const wide = textRoom.width - 2 * edge;
    /** The size the lines can have: as tall as the room allows, then as narrow as it asks. */
    const sizeOf = (lines: string) => {
      const byHeight = Math.min((room.height - 2 * edge) / (lines.split('\n').length * TEXT_LINE_HEIGHT), LARGEST_LETTERS);
      const tried = letters(lines, byHeight);
      return tried.width > wide ? (byHeight * wide) / Math.max(tried.width, 1) : byHeight;
    };
    // A long line is broken in two where that lets the letters grow ("Digitally signed by" over the name), the way Adobe does.
    let best = { lines: text, size: sizeOf(text) };
    for (let tries = 0; tries < 4; tries++) {
      const broken = breakLongest(best.lines);
      if (broken === null) break;
      const size = sizeOf(broken);
      if (size <= best.size) break;
      best = { lines: broken, size };
    }
    const written = letters(best.lines, Math.max(Math.round(best.size * 10) / 10, SMALLEST_LETTERS));
    // From the left of its room, in the middle of its height.
    marks.push(at(written, { x: textRoom.x + edge + written.width / 2, y: room.height / 2 }));
  }
  return marks;
}

/** The lines with the longest one broken at the space nearest its middle; null when it has no space. */
function breakLongest(text: string): string | null {
  const lines = text.split('\n');
  const longest = lines.reduce((found, line, index) => (line.length > (lines[found]?.length ?? 0) ? index : found), 0);
  const line = lines[longest] ?? '';
  let cut = -1;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === ' ' && (cut < 0 || Math.abs(index - line.length / 2) < Math.abs(cut - line.length / 2))) cut = index;
  }
  if (cut <= 0) return null;
  lines.splice(longest, 1, line.slice(0, cut).trimEnd(), line.slice(cut + 1).trimStart());
  return lines.join('\n');
}
