import { canBeWrittenAsText } from '../marks/mark';
import type { Mark } from '../marks/mark';
import { fitText, textAsPicture } from '../marks/measure-text';

/** The usual colour of words written across a page. */
export const WATERMARK_COLOR = '#c62828';

/** The text as a mark of no particular size or place: `watermarkOn` gives it those. */
export function textSample(text: string, color: string, font: string): Mark {
  const mark: Mark = { id: 'sample', kind: 'text', x: 0, y: 0, width: 0, height: 0, rotation: 0, stroke: color, fill: null, opacity: 1, lineWidth: 1, text, font, bold: true, italic: false, size: 100 };
  return canBeWrittenAsText(text) ? fitText(mark) : textAsPicture(mark);
}

/** A mark made as wide as asked: letters change their size, a picture its box. */
export function scaled(mark: Mark, width: number): Mark {
  const factor = mark.width > 0 ? width / mark.width : 1;
  const sized = { ...mark, width, height: mark.height * factor };
  return mark.kind === 'text' ? { ...sized, size: (mark.size ?? 100) * factor } : sized;
}
