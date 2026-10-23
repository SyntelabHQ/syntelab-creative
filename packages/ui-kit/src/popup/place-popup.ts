import type { Box, Size } from '../tooltip/place-tooltip';

/** Where a popup goes, in window coordinates, for `position: fixed`. */
export interface PopupPlace {
  readonly left: number;
  readonly width: number;
  /** Set when the popup opens under its control. */
  readonly top?: number;
  /** Set when it opens above, from the bottom of the window. */
  readonly bottom?: number;
  /** How tall it may grow before its content scrolls. */
  readonly maxHeight: number;
}

/** Space between a control and its popup. */
const GAP = 6;
/** Space kept between a popup and the edge of the window. */
const EDGE = 8;

/**
 * Where a popup (a list that opens from a control) goes so that it stays
 * inside the window: under the control, or above it when there is more room
 * there than under it and not enough under it for `height`. Placed against
 * the window (`position: fixed`), it never makes the page longer, so no
 * scrollbar comes and nothing moves when it opens.
 *
 * `width`: the popup's own width, or the control's when absent. `align`:
 * the edge of the control the popup lines up with, `end` being the right
 * one in left-to-right text.
 */
export function placePopup(control: Box, height: number, window: Size, options: { readonly width?: number; readonly align?: 'start' | 'end'; readonly rightToLeft?: boolean } = {}): PopupPlace {
  const width = Math.min(options.width ?? control.width, window.width - 2 * EDGE);
  const alignsRight = (options.align === 'end') !== (options.rightToLeft ?? false);
  const wanted = alignsRight ? control.left + control.width - width : control.left;
  const left = Math.max(EDGE, Math.min(wanted, window.width - EDGE - width));

  const roomBelow = window.height - (control.top + control.height) - GAP - EDGE;
  const roomAbove = control.top - GAP - EDGE;
  if (roomBelow >= height || roomBelow >= roomAbove) {
    return { left, width, top: control.top + control.height + GAP, maxHeight: Math.max(0, Math.min(height, roomBelow)) };
  }
  return { left, width, bottom: window.height - control.top + GAP, maxHeight: Math.min(height, roomAbove) };
}
