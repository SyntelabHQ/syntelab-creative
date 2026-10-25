import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import styles from './height-grip.module.css';

export interface HeightGripProps {
  /** Already translated: what the grip is dragged for. */
  readonly label: string;
  /** Hears how tall, in pixels, what is just above the grip is dragged to be. */
  readonly onHeight: (height: number) => void;
  /** Puts it back as it ships (a double click). */
  readonly onReset: () => void;
}

/** How far the arrow keys move the grip, in pixels. */
const KEY_STEP = 24;

/**
 * The grip under a list: dragged up or down, it makes what is just above it
 * shorter or taller; the arrow keys do the same, a double click puts it back.
 */
export function HeightGrip({ label, onHeight, onReset }: HeightGripProps) {
  const grip = useRef<HTMLDivElement>(null);
  /** Where the drag began: the pointer, and how tall what is above was then. */
  const start = useRef<{ y: number; height: number } | null>(null);
  const [held, setHeld] = useState(false);

  const above = () => grip.current?.previousElementSibling?.getBoundingClientRect().height ?? 0;
  const end = () => {
    start.current = null;
    setHeld(false);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    onHeight(above() + (event.key === 'ArrowDown' ? KEY_STEP : -KEY_STEP));
  };

  return (
    <div
      ref={grip}
      className={styles.grip}
      role="separator"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-label={label}
      data-dragging={held}
      onPointerDown={(event) => {
        start.current = { y: event.clientY, height: above() };
        setHeld(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        if (start.current) onHeight(start.current.height + event.clientY - start.current.y);
      }}
      onPointerUp={(event) => {
        end();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={key}
    />
  );
}
