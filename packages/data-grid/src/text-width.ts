/**
 * How wide a text is when drawn, in pixels: what a column is fitted to.
 * Measured on a canvas that is never shown, so nothing on the page moves.
 */

let context: CanvasRenderingContext2D | null | undefined;

/** `font` as CSS writes it: `600 14px system-ui`. Without a canvas (in tests), about seven pixels a letter. */
export function textWidth(text: string, font: string): number {
  if (context === undefined) context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!context) return text.length * 7.5;
  context.font = font;
  return context.measureText(text).width;
}
