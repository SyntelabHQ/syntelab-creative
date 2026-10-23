/**
 * Marks: what the user draws and writes on a page. They stay objects (to
 * move, resize, turn, restyle) for as long as the document is open; the Rust
 * side writes them into the page when a file is made.
 *
 * Places and sizes are in PDF points from the top-left corner of the page as
 * it lies in its file, before any turn the user gave it: marks turn with
 * their page.
 */

export const MARK_KINDS = ['rectangle', 'ellipse', 'line', 'arrow', 'check', 'cross', 'dot', 'highlight', 'text', 'redact', 'link', 'textField', 'checkBox', 'radioButton', 'choiceField', 'signatureField', 'bookmark'] as const;
/** What can be drawn with a tool; a `picture` mark comes from elsewhere (text in a script the fonts cannot write). */
export type DrawnKind = (typeof MARK_KINDS)[number];
/**
 * `erase`: the document's own text in the box is taken out of the file (a
 * line being rewritten); `erasePicture`: a picture of the document is (one
 * that is being moved or removed). Both show as blank paper until then.
 * `hiddenText`: the words read off a scanned page (OCR), written into the
 * page unseen; nothing of it shows, and it is not picked up like other marks.
 */
export type MarkKind = DrawnKind | 'picture' | 'erase' | 'erasePicture' | 'attachment' | 'hiddenText';

/**
 * Marks that are not drawn into the page: when a file is made they become a
 * link, a form field, a bookmark or an attached file of the PDF itself. On
 * screen they show as what they will be.
 */
const ADDITION_KINDS = ['link', 'textField', 'checkBox', 'radioButton', 'choiceField', 'signatureField', 'bookmark', 'attachment'] as const;
export type AdditionKind = (typeof ADDITION_KINDS)[number];
export const isAddition = (kind: MarkKind): kind is AdditionKind => (ADDITION_KINDS as readonly string[]).includes(kind);
/** The form fields among them: each has a name of its own in the document. */
export const isField = (kind: MarkKind) => kind === 'textField' || kind === 'checkBox' || kind === 'signatureField' || kind === 'choiceField' || kind === 'radioButton';
/** The ones that are a sign of a fixed size at a place, not a box the user sizes. */
const isSign = (kind: MarkKind) => kind === 'bookmark' || kind === 'attachment';

/** The fonts every PDF reader has; any other name is a font installed on the computer (see `fonts.ts`). */
export const BUILT_IN_FONTS = ['sans', 'serif', 'mono'] as const;
/** One of `BUILT_IN_FONTS`, or the name of a font of the computer. */
export type FontFamily = string;

/** How the lines of a text stand in its box. */
export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export interface Mark {
  readonly id: string;
  readonly kind: MarkKind;
  /**
   * The box of the mark. For a line or an arrow: from (`x`, `y`) to
   * (`x + width`, `y + height`), so its sizes may be negative.
   */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Degrees clockwise about the middle of its box. */
  readonly rotation: number;
  /** Color of the line (of the letters, for text) as `#rrggbb`, or null for none. */
  readonly stroke: string | null;
  readonly fill: string | null;
  /** From 0 (cannot be seen) to 1 (hides what is under it). */
  readonly opacity: number;
  readonly lineWidth: number;
  // Text only.
  readonly text?: string;
  readonly font?: FontFamily;
  readonly bold?: boolean;
  readonly italic?: boolean;
  /** Size of the letters, in points. */
  readonly size?: number;
  /** Left when not said. */
  readonly align?: TextAlign;
  /** Picture only: the picture as a `data:` address. */
  readonly data?: string;
  /** Link only: the address it leads to… */
  readonly url?: string;
  /** …or the page it leads to, by that page's key in the plan: it follows the page when pages are moved. */
  readonly toPageKey?: string;
  /** The name of a form field, the title of a bookmark, the name of an attached file. */
  readonly name?: string;
  /** Attachment only: where the file is on this computer. */
  readonly path?: string;
  /** Text field only: it takes several lines. */
  readonly multiline?: boolean;
  /** Hidden text only: the words, each with its box on the page; and how far the page is turned for them to stand upright. */
  readonly words?: readonly { readonly text: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }[];
  readonly turn?: number;
  /** A list to choose from only: its answers. */
  readonly options?: readonly string[];
  /** Radio button only: the answer it stands for, among the buttons of its name (its group). */
  readonly value?: string;
  /** Attachment only: who attached the file. */
  readonly author?: string;
  /**
   * Marks that are the same thing on several pages (a signature on every
   * page) carry the same group: what is done to one is done to all.
   */
  readonly group?: string;
}

/** What the next mark will look like; also what the toolbar shows. */
export interface MarkStyle {
  /** The line of shapes. Text has a color of its own: letters are mostly black, shapes mostly not. */
  readonly stroke: string | null;
  /** The color of text, as `#rrggbb`. */
  readonly textColor: string;
  readonly fill: string | null;
  readonly opacity: number;
  readonly lineWidth: number;
  readonly font: FontFamily;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly size: number;
  readonly align: TextAlign;
}

/** A line and no filling, as asked: shapes frame what they are drawn around. */
export const DEFAULT_STYLE: MarkStyle = {
  stroke: '#d62828',
  textColor: '#000000',
  fill: null,
  opacity: 1,
  lineWidth: 2,
  font: 'sans',
  bold: false,
  italic: false,
  size: 14,
  align: 'left',
};

export const HIGHLIGHT_COLOR = '#ffeb00';
const HIGHLIGHT_OPACITY = 0.45;

/** The same numbers the Rust side writes text by. */
export const TEXT_ASCENT = 0.8;
export const TEXT_LINE_HEIGHT = 1.25;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const isLine = (mark: Pick<Mark, 'kind'>) => mark.kind === 'line' || mark.kind === 'arrow';

let nextId = 0;
function newId(): string {
  nextId += 1;
  return `mark-${Date.now().toString(36)}-${nextId}`;
}

/** Sizes a mark gets from a click without a drag, in points. */
const CLICK_SIZES: Partial<Record<DrawnKind, readonly [number, number]>> = {
  rectangle: [90, 56],
  ellipse: [90, 56],
  check: [16, 16],
  cross: [16, 16],
  dot: [10, 10],
  highlight: [120, 16],
  redact: [120, 16],
  link: [130, 18],
  textField: [170, 22],
  checkBox: [14, 14],
  radioButton: [14, 14],
  choiceField: [170, 22],
  signatureField: [180, 50],
  bookmark: [18, 18],
  line: [90, 0],
  arrow: [90, 0],
};
/** A drag shorter than this, in points, counts as a click. */
const CLICK_DISTANCE = 3;

/** A new mark drawn from `from` to `to` (a click when they are the same place). */
export function drawMark(kind: DrawnKind, style: MarkStyle, from: Point, to: Point): Mark {
  let [x, y, width, height] = [from.x, from.y, to.x - from.x, to.y - from.y];
  // A sign has one size, wherever the drag went.
  const clicked = Math.hypot(width, height) < CLICK_DISTANCE || isSign(kind);
  if (clicked) {
    const [clickWidth, clickHeight] = CLICK_SIZES[kind] ?? [0, 0];
    // Lines start where the click was; everything else is put around it.
    [x, y, width, height] = isLine({ kind }) ? [from.x, from.y, clickWidth, clickHeight] : [from.x - clickWidth / 2, from.y - clickHeight / 2, clickWidth, clickHeight];
  } else if (!isLine({ kind })) {
    [x, y, width, height] = [Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(width), Math.abs(height)];
  }
  const base = { id: newId(), kind, x, y, width, height, rotation: 0, opacity: style.opacity, lineWidth: style.lineWidth };
  // What is under it is taken out of the file when it is written; until then it is a black box that can still be moved.
  if (kind === 'redact') return { ...base, stroke: null, fill: '#000000', opacity: 1 };
  if (isAddition(kind)) return { ...base, stroke: null, fill: null, opacity: 1, lineWidth: 1 };
  if (kind === 'highlight') return { ...base, stroke: null, fill: style.fill ?? HIGHLIGHT_COLOR, opacity: Math.min(style.opacity, HIGHLIGHT_OPACITY) };
  if (kind === 'text') {
    const { font, bold, italic, size, align } = style;
    return { ...base, x: from.x, y: from.y, width: 0, height: 0, stroke: style.textColor, fill: null, text: '', font, bold, italic, size, align };
  }
  // A shape nobody could see is of no use: without a filling it always has a line.
  const closed = kind === 'rectangle' || kind === 'ellipse';
  return { ...base, stroke: style.stroke ?? (closed && style.fill ? null : '#000000'), fill: closed ? style.fill : null };
}

/** The mark with the parts of `style` that mean something for its kind. */
export function restyle(mark: Mark, style: Partial<MarkStyle>): Mark {
  // What hides something for good always looks the same.
  if (mark.kind === 'redact' || mark.kind === 'erase' || mark.kind === 'erasePicture' || mark.kind === 'hiddenText' || isAddition(mark.kind)) return mark;
  if (mark.kind === 'text') {
    // Text takes its own color, never the line color of shapes.
    const { stroke: _line, textColor, ...rest } = style;
    style = textColor !== undefined ? { ...rest, stroke: textColor } : rest;
  }
  const next: { -readonly [Key in keyof Mark]: Mark[Key] } = { ...mark };
  if (style.opacity !== undefined) next.opacity = style.opacity;
  if (style.lineWidth !== undefined) next.lineWidth = style.lineWidth;
  if (mark.kind === 'highlight') {
    if (style.fill) next.fill = style.fill;
    return next;
  }
  if (style.stroke !== undefined) next.stroke = style.stroke;
  if (mark.kind === 'rectangle' || mark.kind === 'ellipse') {
    if (style.fill !== undefined) next.fill = style.fill;
    // Neither line nor filling would make it vanish.
    if (!next.stroke && !next.fill) next.stroke = mark.stroke ?? '#000000';
  } else if (!next.stroke) {
    next.stroke = mark.stroke ?? '#000000';
  }
  if (mark.kind === 'text') {
    if (style.font !== undefined) next.font = style.font;
    if (style.bold !== undefined) next.bold = style.bold;
    if (style.italic !== undefined) next.italic = style.italic;
    if (style.size !== undefined) next.size = style.size;
    if (style.align !== undefined) next.align = style.align;
  }
  return next;
}

/** The style a mark has, laid over `fallback` for the parts its kind does not use. */
export function styleOf(mark: Mark, fallback: MarkStyle): MarkStyle {
  return {
    ...fallback,
    stroke: mark.kind === 'highlight' || mark.kind === 'text' ? fallback.stroke : mark.stroke,
    textColor: mark.kind === 'text' ? (mark.stroke ?? fallback.textColor) : fallback.textColor,
    fill: mark.kind === 'rectangle' || mark.kind === 'ellipse' || mark.kind === 'highlight' ? mark.fill : fallback.fill,
    opacity: mark.opacity,
    lineWidth: mark.lineWidth,
    ...(mark.kind === 'text'
      ? { font: mark.font ?? fallback.font, bold: mark.bold ?? false, italic: mark.italic ?? false, size: mark.size ?? fallback.size, align: mark.align ?? 'left' }
      : {}),
  };
}

export function moveMark(mark: Mark, dx: number, dy: number): Mark {
  return { ...mark, x: mark.x + dx, y: mark.y + dy };
}

export function centerOf(mark: Mark): Point {
  return { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 };
}

/** `point` turned `degrees` clockwise (as seen on the page) about `center`. */
export function turnPoint(point: Point, center: Point, degrees: number): Point {
  const angle = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const [dx, dy] = [point.x - center.x, point.y - center.y];
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/**
 * The handles a box is resized by: which way each pulls, as a share of the
 * box's width and height from its middle (-1, 0 or 1).
 */
export const BOX_HANDLES = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
} as const;
export type BoxHandle = keyof typeof BOX_HANDLES;
export type MarkHandle = BoxHandle | 'start' | 'end' | 'turn';

/** The least a box measures on a side after resizing, in points. */
const SMALLEST = 2;
/** The letters of a text, in points, when it is resized by its corners. */
const SMALLEST_TEXT_SIZE = 4;
const LARGEST_TEXT_SIZE = 400;

/**
 * The mark after one of its handles was dragged to `point`. A turned box
 * keeps its opposite side (or corner) where it is on the page. A picture
 * pulled by a corner keeps its shape; a text gets larger or smaller letters
 * (`fitted` gives it the box its text then takes, see `measure-text.ts`).
 */
export function resizeMark(mark: Mark, handle: MarkHandle, point: Point, fitted: (mark: Mark) => Mark = (same) => same): Mark {
  if (handle === 'start') return { ...mark, x: point.x, y: point.y, width: mark.x + mark.width - point.x, height: mark.y + mark.height - point.y };
  if (handle === 'end') return { ...mark, width: point.x - mark.x, height: point.y - mark.y };
  if (handle === 'turn') return turnMarkTo(mark, point);

  const [pullX, pullY] = BOX_HANDLES[handle];
  const center = centerOf(mark);
  // The place that stays put: opposite the handle, on the turned box.
  const anchorLocal = { x: center.x - (pullX * mark.width) / 2, y: center.y - (pullY * mark.height) / 2 };
  const anchor = turnPoint(anchorLocal, center, mark.rotation);
  // The drag measured along the box's own sides.
  const along = turnPoint(point, anchor, -mark.rotation);
  let width = pullX === 0 ? mark.width : Math.max((along.x - anchor.x) * pullX, SMALLEST);
  let height = pullY === 0 ? mark.height : Math.max((along.y - anchor.y) * pullY, SMALLEST);
  let sized = mark;
  if (mark.kind === 'text' || ((mark.kind === 'picture' || mark.kind === 'attachment') && pullX !== 0 && pullY !== 0)) {
    // How much larger it gets: by the side that was pulled further.
    const grown = Math.max(pullX === 0 ? 0 : width / Math.max(mark.width, SMALLEST), pullY === 0 ? 0 : height / Math.max(mark.height, SMALLEST));
    if (mark.kind === 'text') {
      const size = Math.min(Math.max((mark.size ?? DEFAULT_STYLE.size) * grown, SMALLEST_TEXT_SIZE), LARGEST_TEXT_SIZE);
      sized = fitted({ ...mark, size: Math.round(size * 10) / 10 });
      [width, height] = [sized.width, sized.height];
    } else {
      [width, height] = [mark.width * grown, mark.height * grown];
    }
  }
  // The new middle, found from the anchor along the turned sides.
  const middle = turnPoint({ x: anchor.x + (pullX * width) / 2, y: anchor.y + (pullY * height) / 2 }, anchor, mark.rotation);
  return { ...sized, x: middle.x - width / 2, y: middle.y - height / 2, width, height };
}

/** Angles a turned mark settles on when it comes close, in degrees. */
const SNAP_EVERY = 45;
const SNAP_WITHIN = 4;

/** Turns the mark so that its turn handle (above its top) points at `point`. */
function turnMarkTo(mark: Mark, point: Point): Mark {
  const center = centerOf(mark);
  let degrees = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90;
  degrees = ((degrees % 360) + 360) % 360;
  const nearest = Math.round(degrees / SNAP_EVERY) * SNAP_EVERY;
  if (Math.abs(degrees - nearest) <= SNAP_WITHIN) degrees = nearest % 360;
  return { ...mark, rotation: Math.round(degrees * 10) / 10 };
}

/** The head of an arrow, as the Rust side draws it: its length and half of its width. */
export function arrowHead(lineWidth: number, arrowLength: number): { length: number; halfWidth: number } {
  const length = Math.min(Math.max(lineWidth * 4, 8), arrowLength);
  return { length, halfWidth: length * 0.38 };
}

/** The font of a text mark as CSS (and the canvas) names it. */
export function cssFont(mark: Pick<Mark, 'font' | 'bold' | 'italic' | 'size'>): { family: string; weight: number; style: string; size: number } {
  const named = mark.font && !(BUILT_IN_FONTS as readonly string[]).includes(mark.font) ? `"${mark.font.replace(/["\\]/g, '')}", ` : '';
  const family = mark.font === 'serif' ? "'Times New Roman', Times, serif" : mark.font === 'mono' ? "'Courier New', Courier, monospace" : `${named}Arial, Helvetica, sans-serif`;
  return { family, weight: mark.bold ? 700 : 400, style: mark.italic ? 'italic' : 'normal', size: mark.size ?? DEFAULT_STYLE.size };
}

/** A text mark with its box made to fit its lines; `widthOf` measures one line at the mark's font. */
export function fitTextBox(mark: Mark, widthOf: (line: string) => number): Mark {
  const lines = (mark.text ?? '').split('\n');
  const size = mark.size ?? DEFAULT_STYLE.size;
  const width = Math.max(...lines.map(widthOf), size / 2);
  return { ...mark, width, height: lines.length * size * TEXT_LINE_HEIGHT };
}

/**
 * True when the fonts the Rust side writes with have every letter of the
 * text: Latin with its accents, Greek, Cyrillic, common signs. Other scripts
 * (and those that join or reorder letters) are written as a picture instead.
 */
export function canBeWrittenAsText(text: string): boolean {
  for (const letter of text) {
    const code = letter.codePointAt(0) ?? 0;
    const simple = code < 0x0530 || (code >= 0x1e00 && code <= 0x1fff) || (code >= 0x2000 && code <= 0x22ff);
    if (!simple) return false;
  }
  return true;
}

/**
 * An address as typed, made whole: `syntelab.com` leads to
 * `https://syntelab.com`, `ana@syntelab.com` to `mailto:ana@syntelab.com`.
 */
function fullAddress(typed: string): string {
  const address = typed.trim();
  if (address === '' || /^[a-z][a-z0-9+.-]*:/i.test(address)) return address;
  return /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(address) ? `mailto:${address}` : `https://${address}`;
}

/** `#rrggbb` as the Rust side takes colors: red, green and blue from 0 to 1. */
export function colorParts(color: string): [number, number, number] {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color)?.[1] ?? '000000';
  return [0, 2, 4].map((at) => Math.round((Number.parseInt(hex.slice(at, at + 2), 16) / 255) * 1000) / 1000) as [number, number, number];
}

/** A mark as the Rust side takes it. */
export function markRequest(mark: Mark): Record<string, unknown> {
  const { kind, x, y, width, height, rotation, opacity, lineWidth } = mark;
  const request: Record<string, unknown> = {
    kind,
    x,
    y,
    width,
    height,
    rotation,
    opacity,
    lineWidth,
    stroke: mark.stroke ? colorParts(mark.stroke) : null,
    fill: mark.fill ? colorParts(mark.fill) : null,
  };
  if (kind === 'text') Object.assign(request, { text: mark.text ?? '', font: mark.font ?? 'sans', bold: mark.bold ?? false, italic: mark.italic ?? false, size: mark.size ?? DEFAULT_STYLE.size, align: mark.align ?? 'left' });
  if (kind === 'picture') request.data = (mark.data ?? '').slice((mark.data ?? '').indexOf(',') + 1);
  // Which page a link leads to is said by the plan, which knows where that page ends up (see `planRequest`).
  if (kind === 'link') request.url = fullAddress(mark.url ?? '');
  if (isField(kind) || isSign(kind)) request.name = mark.name ?? '';
  if (kind === 'textField') request.multiline = mark.multiline ?? false;
  if (kind === 'hiddenText') Object.assign(request, { words: mark.words ?? [], turn: mark.turn ?? 0 });
  if (kind === 'choiceField') request.options = mark.options ?? [];
  if (kind === 'radioButton') request.value = mark.value ?? '';
  if (kind === 'attachment') Object.assign(request, { path: mark.path ?? '', author: mark.author ?? '' });
  return request;
}
