import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import styles from "./column-splitter.module.css";

export interface ColumnSplitterProps {
  /** Already translated: what the bar is dragged for. */
  readonly label: string;
  /** Hears where the bar is dragged to: its share (0 to 1) of the width of what it divides (its parent). */
  readonly onMove: (share: number) => void;
  /** Hears the arrow keys: a step towards the start (-1) or the end (+1). */
  readonly onStep: (by: -1 | 1) => void;
  /** Puts the columns back as they ship (a double click). */
  readonly onReset: () => void;
}

/**
 * The bar between two columns: dragged with the mouse or a finger, moved with
 * the arrow keys, put back with a double click. Drawn as the line between the
 * panes of Scribe and Dev.
 */
export function ColumnSplitter({
  label,
  onMove,
  onStep,
  onReset,
}: ColumnSplitterProps) {
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [held, setHeld] = useState(false);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const around = bar.current?.parentElement?.getBoundingClientRect();
    if (!dragging.current || !around || around.width <= 0) return;
    // Counted from where the columns start: the right edge where the program is written from right to left.
    const fromRight =
      getComputedStyle(bar.current as Element).direction === "rtl";
    const pixels = fromRight
      ? around.right - event.clientX
      : event.clientX - around.left;
    onMove(Math.min(Math.max(pixels / around.width, 0), 1));
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    onStep((event.key === "ArrowLeft") !== rtl ? -1 : 1);
  };

  return (
    <div
      ref={bar}
      className={styles.splitter}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
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
