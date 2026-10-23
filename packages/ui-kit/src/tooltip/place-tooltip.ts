import type { TooltipSide } from './tooltip';

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Space between a control and its tooltip. */
const GAP = 6;
/** Space kept between a tooltip and the edge of the window. */
const EDGE = 6;

/**
 * Where the top left corner of a tooltip goes, so that it sits on the asked
 * side of its control and stays whole inside the window. A tooltip that has
 * no room on its side goes to the opposite one.
 */
export function placeTooltip(control: Box, tip: Size, side: TooltipSide, window: Size, rightToLeft = false): { left: number; top: number } {
  const centerX = control.left + control.width / 2 - tip.width / 2;
  const centerY = control.top + control.height / 2 - tip.height / 2;
  const right = control.left + control.width;
  const bottom = control.top + control.height;

  const above = control.top - GAP - tip.height;
  const below = bottom + GAP;
  const before = control.left - GAP - tip.width;
  const after = right + GAP;
  const fitsBelow = below + tip.height <= window.height - EDGE;
  const fitsAbove = above >= EDGE;
  const fitsBefore = before >= EDGE;
  const fitsAfter = after + tip.width <= window.width - EDGE;

  let left: number;
  let top: number;
  if (side === 'start' || side === 'end') {
    // "After" in reading direction is the right in left-to-right text.
    const wantsRight = (side === 'end') !== rightToLeft;
    const goesRight = wantsRight ? fitsAfter || !fitsBefore : !fitsBefore && fitsAfter;
    left = goesRight ? after : before;
    top = centerY;
  } else {
    const goesBelow = side === 'top' ? !fitsAbove && fitsBelow : fitsBelow || !fitsAbove;
    top = goesBelow ? below : above;
    if (side === 'bottom-end') left = rightToLeft ? control.left : right - tip.width;
    else left = centerX;
  }

  const clamp = (value: number, max: number) => Math.max(EDGE, Math.min(value, max));
  return { left: clamp(left, window.width - EDGE - tip.width), top: clamp(top, window.height - EDGE - tip.height) };
}
