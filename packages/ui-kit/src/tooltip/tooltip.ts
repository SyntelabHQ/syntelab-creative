/** Where a tooltip appears, relative to its control. */
export type TooltipSide =
  /** Under the control, centered. */
  | 'bottom'
  /** Under the control, lined up with its end edge (for controls near the window edge). */
  | 'bottom-end'
  /** Above the control, centered. */
  | 'top'
  /** After the control, in reading direction (for vertical bars). */
  | 'end'
  /** Before the control, in reading direction (for a vertical bar on the far edge). */
  | 'start';

/**
 * Attributes that give any element a tooltip (shown by `tooltip-layer.ts`).
 * The text must already be translated. It is shown on hover and on keyboard
 * focus; it does not replace the element's accessible name.
 */
export function tooltip(text: string, side: TooltipSide = 'bottom') {
  return { 'data-tooltip': text, 'data-tooltip-side': side } as const;
}
