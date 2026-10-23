import { canBeWrittenAsText, cssFont, DEFAULT_STYLE, fitTextBox, TEXT_ASCENT, TEXT_LINE_HEIGHT } from './mark';
import type { Mark } from './mark';

let canvas: HTMLCanvasElement | null = null;

function contextFor(mark: Mark, scale = 1): CanvasRenderingContext2D | null {
  canvas ??= document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const font = cssFont(mark);
  context.font = `${font.style} ${font.weight} ${font.size * scale}px ${font.family}`;
  return context;
}

/** A text mark with its box made to fit its text, measured in the font it is shown in. */
export function fitText(mark: Mark): Mark {
  const context = contextFor(mark);
  const size = mark.size ?? DEFAULT_STYLE.size;
  // Without a canvas: a fair guess, half a letter size per letter.
  return fitTextBox(mark, (line) => context?.measureText(line).width ?? line.length * size * 0.5);
}

/** How many pixels per point the picture of a text is drawn with: sharp when printed. */
const PICTURE_SCALE = 4;

/**
 * A text mark as a picture mark of the same look and place: for text in a
 * script the fonts of the Rust side cannot write (Arabic, Chinese…). The web
 * view draws it with the fonts of the computer.
 */
export function textAsPicture(mark: Mark): Mark {
  const fitted = fitText(mark);
  const size = mark.size ?? DEFAULT_STYLE.size;
  const drawing = document.createElement('canvas');
  // Room on every side for letters that reach outside their line (accents, descenders, slanted ends).
  const margin = size * 0.4;
  drawing.width = Math.ceil((fitted.width + margin * 2) * PICTURE_SCALE);
  drawing.height = Math.ceil((fitted.height + margin * 2) * PICTURE_SCALE);
  const context = drawing.getContext('2d');
  if (!context) return fitted;
  const font = cssFont(mark);
  context.font = `${font.style} ${font.weight} ${font.size * PICTURE_SCALE}px ${font.family}`;
  context.fillStyle = mark.stroke ?? '#000000';
  context.textBaseline = 'alphabetic';
  const rightToLeft = /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(mark.text ?? '');
  context.direction = rightToLeft ? 'rtl' : 'ltr';
  context.textAlign = rightToLeft ? 'right' : 'left';
  (mark.text ?? '').split('\n').forEach((line, number) => {
    const x = rightToLeft ? fitted.width + margin : margin;
    context.fillText(line, x * PICTURE_SCALE, (margin + size * TEXT_ASCENT + number * size * TEXT_LINE_HEIGHT) * PICTURE_SCALE);
  });
  const { id, x, y, rotation, opacity } = fitted;
  return {
    id,
    kind: 'picture',
    x: x - margin,
    y: y - margin,
    width: fitted.width + margin * 2,
    height: fitted.height + margin * 2,
    rotation,
    stroke: null,
    fill: null,
    opacity,
    lineWidth: 1,
    data: drawing.toDataURL('image/png'),
  };
}

/** A text mark ready to write: fitted to its text, or drawn as a picture when the PDF fonts cannot write it. */
export function fitted(mark: Mark): Mark {
  return canBeWrittenAsText(mark.text ?? '') ? fitText(mark) : textAsPicture(mark);
}
