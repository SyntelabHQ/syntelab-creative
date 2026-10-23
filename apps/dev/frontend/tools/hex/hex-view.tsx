import type { AppHost } from '@syntelab/shell-api';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { bytesOf, letterOf, offsetText } from './hex-bytes';
import styles from './hex-view.module.css';

/** What is picked: from the byte the picking began at to the one it reached, both of them picked. */
export interface Picked {
  readonly anchor: number;
  readonly focus: number;
}

export interface HexViewProps {
  readonly host: Pick<AppHost, 'invoke'>;
  /** The number the Rust side holds the bytes under, and how many they are. */
  readonly hex: number;
  readonly size: number;
  readonly perRow: number;
  readonly offsets: 'hex' | 'decimal';
  /** The letters the column of text shows the bytes beyond ASCII as. */
  readonly letters: 'ascii' | 'latin1';
  readonly picked: Picked | null;
  readonly onPick: (picked: Picked) => void;
  /** Read by screen readers. */
  readonly label: string;
  /** The bytes could not be read (the file is gone). */
  readonly onProblem: (error: unknown) => void;
}

export interface HexViewHandle {
  /** Brings a byte into sight, a few rows from the top when it was out of it. */
  show(offset: number): void;
}

const ROW = 22;
/** The tallest the track of the scrollbar is made: beyond it, the bar stands for the rows in proportion. */
const TALLEST = 6_000_000;
/** Rows read beyond those in sight, on each side, so a small move shows bytes at once. */
const BEYOND = 40;
/** The most rows drawn at once, however tall the place is said to be. */
const MOST_DRAWN = 400;

/**
 * Bytes laid out in rows: where each row begins, its bytes as two
 * hexadecimal digits each, and the same bytes as letters. Only the rows in
 * sight are drawn, and only they (with some around them) are asked of the
 * Rust side: how many bytes there are makes no difference. The scrollbar
 * stands for all the rows, in proportion once they are too many for a
 * browser to lay out.
 *
 * A byte is picked with a click, more with a drag or a click with Shift;
 * the arrows, Page Up and Down, Home and End move what is picked.
 */
export const HexView = forwardRef<HexViewHandle, HexViewProps>(function HexView({ host, hex, size, perRow, offsets, letters, picked, onPick, label, onProblem }, handle) {
  const rows = Math.ceil(size / perRow);
  const area = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  /** The scrollbar is being moved to where the rows are: what it then says is not a move by the user. */
  const placing = useRef(false);
  const [height, setHeight] = useState(0);
  const [top, setTop] = useState(0);
  /** The bytes that were read last, and where they begin. */
  const [page, setPage] = useState<{ readonly from: number; readonly bytes: Uint8Array } | null>(null);
  const dragging = useRef(false);

  const inSight = Math.max(1, Math.min(MOST_DRAWN, Math.floor(height / ROW)));
  const lastTop = Math.max(0, rows - inSight);
  const track = Math.min(rows * ROW, TALLEST);
  const goTo = (row: number) => setTop(Math.max(0, Math.min(lastTop, Math.round(row))));

  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight);
    measure();
    const watching = new ResizeObserver(measure);
    watching.observe(element);
    return () => watching.disconnect();
  }, []);

  // Fewer rows fit, or there are fewer rows: the top one is never beyond the last it can be.
  useEffect(() => {
    if (top > lastTop) setTop(lastTop);
  }, [lastTop]);

  // The rows in sight, with some around them, are read whenever they are not all held.
  useEffect(() => {
    const from = top * perRow;
    const to = Math.min(size, (top + inSight + 1) * perRow);
    if (page && page.from <= from && page.from + page.bytes.length >= to) return;
    let current = true;
    const start = Math.max(0, top - BEYOND) * perRow;
    host.invoke<{ from: number; bytes: string }>('hex_rows', { hex, from: start, count: (inSight + 1 + BEYOND * 2) * perRow }).then(
      (answer) => current && setPage({ from: answer.from, bytes: bytesOf(answer.bytes) }),
      (error: unknown) => current && onProblem(error),
    );
    return () => {
      current = false;
    };
  }, [host.invoke, hex, size, perRow, top, inSight, page]);

  // Other bytes, or laid out otherwise: what was read is of no use.
  useEffect(() => {
    setPage(null);
  }, [hex, perRow]);

  // The scrollbar follows the rows.
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const room = element.scrollHeight - element.clientHeight;
    const wanted = lastTop === 0 ? 0 : Math.round((top / lastTop) * room);
    if (Math.abs(element.scrollTop - wanted) > 1) {
      placing.current = true;
      element.scrollTop = wanted;
    }
  }, [top, lastTop, track, height]);

  const onBar = () => {
    const element = bar.current;
    if (!element) return;
    if (placing.current) {
      placing.current = false;
      return;
    }
    const room = element.scrollHeight - element.clientHeight;
    if (room > 0) goTo((element.scrollTop / room) * lastTop);
  };

  // The wheel moves by rows; it is listened to outside React so it can be kept from moving anything else.
  const latest = useRef({ top, goTo });
  latest.current = { top, goTo };
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const by = event.deltaMode === 1 ? event.deltaY : event.deltaY / ROW;
      latest.current.goTo(latest.current.top + (by > 0 ? Math.max(1, Math.round(by)) : Math.min(-1, Math.round(by))));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  const show = (offset: number) => {
    const row = Math.floor(offset / perRow);
    if (row < top || row >= top + inSight) goTo(row - Math.min(3, Math.floor(inSight / 2)));
  };
  useImperativeHandle(handle, () => ({ show }));

  /** Moves what is picked to a byte, keeping where the picking began when it is being stretched. */
  const move = (to: number, stretch: boolean) => {
    if (size === 0) return;
    const focus = Math.max(0, Math.min(size - 1, to));
    onPick({ anchor: stretch && picked ? picked.anchor : focus, focus });
    const row = Math.floor(focus / perRow);
    if (row < top) goTo(row);
    else if (row >= top + inSight) goTo(row - inSight + 1);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = picked?.focus ?? top * perRow;
    const all = event.ctrlKey || event.metaKey;
    const to: Readonly<Record<string, number>> = {
      ArrowLeft: at - 1,
      ArrowRight: at + 1,
      ArrowUp: at - perRow,
      ArrowDown: at + perRow,
      PageUp: at - perRow * inSight,
      PageDown: at + perRow * inSight,
      Home: all ? 0 : at - (at % perRow),
      End: all ? size - 1 : at - (at % perRow) + perRow - 1,
    };
    const target = to[event.key];
    if (target !== undefined) {
      event.preventDefault();
      move(target, event.shiftKey);
    } else if (all && event.key.toLowerCase() === 'a' && size > 0) {
      event.preventDefault();
      onPick({ anchor: 0, focus: size - 1 });
    }
  };

  /** The byte a cell stands for; none when what is under the pointer is no cell. */
  const cellAt = (event: MouseEvent): number | null => {
    const at = (event.target as HTMLElement).closest<HTMLElement>('[data-at]')?.dataset.at;
    return at === undefined ? null : Number(at);
  };
  const onDown = (event: MouseEvent) => {
    const at = cellAt(event);
    if (at === null || event.button !== 0) return;
    dragging.current = true;
    move(at, event.shiftKey);
  };
  const onOver = (event: MouseEvent) => {
    if (!dragging.current || event.buttons !== 1) return void (dragging.current = false);
    const at = cellAt(event);
    if (at !== null && picked && at !== picked.focus) onPick({ anchor: picked.anchor, focus: at });
  };

  const low = picked ? Math.min(picked.anchor, picked.focus) : -1;
  const high = picked ? Math.max(picked.anchor, picked.focus) : -1;
  const drawn = Math.min(inSight + 1, rows - top);

  return (
    <div className={styles.view} dir="ltr">
      <div ref={area} className={styles.rows} role="grid" aria-label={label} aria-rowcount={rows} tabIndex={0} onKeyDown={onKey} onMouseDown={onDown} onMouseOver={onOver} onMouseUp={() => (dragging.current = false)}>
        {Array.from({ length: Math.max(0, drawn) }, (_, index) => {
          const from = (top + index) * perRow;
          const cells = Math.min(perRow, size - from);
          const byteAt = (at: number) => (page && at >= page.from && at < page.from + page.bytes.length ? (page.bytes[at - page.from] as number) : null);
          return (
            <div key={from} className={styles.row} role="row" aria-rowindex={top + index + 1}>
              <span className={styles.offset} role="rowheader">
                {offsetText(from, offsets, size)}
              </span>
              <span className={styles.bytes} data-per-row={perRow}>
                {Array.from({ length: cells }, (_, cell) => {
                  const at = from + cell;
                  const byte = byteAt(at);
                  return (
                    <span key={cell} role="gridcell" data-at={at} data-picked={at >= low && at <= high} data-focus={at === picked?.focus} data-gap={cell > 0 && cell % 8 === 0} data-zero={byte === 0}>
                      {byte === null ? '  ' : byte.toString(16).toUpperCase().padStart(2, '0')}
                    </span>
                  );
                })}
              </span>
              <span className={styles.letters} aria-hidden="true">
                {Array.from({ length: cells }, (_, cell) => {
                  const at = from + cell;
                  const byte = byteAt(at);
                  return (
                    <span key={cell} data-at={at} data-picked={at >= low && at <= high} data-focus={at === picked?.focus} data-dim={byte !== null && (byte < 0x20 || byte >= 0x7f)}>
                      {byte === null ? ' ' : letterOf(byte, letters)}
                    </span>
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
      <div ref={bar} className={styles.bar} onScroll={onBar} aria-hidden="true">
        <div style={{ height: track }} />
      </div>
    </div>
  );
});
