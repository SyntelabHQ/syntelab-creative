import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import styles from './splitter.module.css';

export interface SplitterProps {
  /** `vertical`: a bar between two panes that stand side by side; `horizontal`: between one above the other. */
  readonly orientation: 'vertical' | 'horizontal';
  /** Already translated: what the bar is dragged for. */
  readonly label: string;
  /**
   * Hears where the bar is dragged to: how far it is from the start of what it divides, as a share (0 to 1) and in
   * pixels. `around` is the element whose room is divided: the parent of the bar unless another is given.
   */
  readonly onMove: (share: number, pixels: number, size: number) => void;
  /** Hears the arrow keys: a step towards the start (-1) or the end (+1). */
  readonly onStep: (by: -1 | 1) => void;
  /** Puts the division back as it ships (a double click). */
  readonly onReset?: () => void;
}

/**
 * The bar between two panes: dragged with the mouse or a finger, moved with
 * the arrow keys, put back with a double click.
 */
export function Splitter({ orientation, label, onMove, onStep, onReset }: SplitterProps) {
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  /** Drawn in the colour of the program for as long as it is held, as the line between the panes of Dev. */
  const [held, setHeld] = useState(false);
  const vertical = orientation === 'vertical';

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const around = bar.current?.parentElement?.getBoundingClientRect();
    if (!dragging.current || !around) return;
    const size = vertical ? around.width : around.height;
    if (size <= 0) return;
    // Counted from where the panes start: the right edge where the program is written from right to left.
    const fromRight = vertical && getComputedStyle(bar.current as Element).direction === 'rtl';
    const pixels = vertical ? (fromRight ? around.right - event.clientX : event.clientX - around.left) : event.clientY - around.top;
    onMove(Math.min(Math.max(pixels / size, 0), 1), pixels, size);
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const back = vertical ? 'ArrowLeft' : 'ArrowUp';
    const forth = vertical ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== back && event.key !== forth) return;
    event.preventDefault();
    onStep(event.key === back ? -1 : 1);
  };

  return (
    <div
      ref={bar}
      className={styles.splitter}
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      data-orientation={orientation}
      data-dragging={held}
      onPointerDown={(event) => {
        dragging.current = true;
        setHeld(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        dragging.current = false;
        setHeld(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setHeld(false);
      }}
      onDoubleClick={onReset}
      onKeyDown={key}
    />
  );
}
