import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { sharedWidths } from './widths';
import styles from './data-grid.module.css';
import { isColumnSelected, isRowSelected, isSelected, move, selectAll, selectCell, selectColumns, selectedRowRuns, selectRows, stretchTo, toggleCell } from './selection';
import type { CellPlace, Selection } from './selection';
import { textWidth } from './text-width';

/** A column as the grid draws it. */
export interface GridColumn {
  readonly id: string;
  /** What its head says, already translated: its name, its symbol, or both. One of the two may be empty. */
  readonly title: string;
  readonly symbol: string;
  readonly color?: string;
  /** The width it was given; null while it shares the room with the others. */
  readonly width: number | null;
  /** Its values are text, not numbers: written from the start of the cell. */
  readonly text?: boolean;
  /** Its values are read as text is, from the start of the cell; else they stand at its end, as numbers do. */
  readonly fromStart?: boolean;
  /** Held at the start or at the end while the table is scrolled sideways. */
  readonly held: 'start' | 'end' | null;
}

export interface DataGridProps {
  readonly columns: readonly GridColumn[];
  readonly rowCount: number;
  /**
   * Empty rows go on below the last, as far as the table is scrolled: a cell of one of them can be typed in, and
   * the table becomes as long as that. Only what the rows of `rowCount` hold is asked for.
   */
  readonly endless?: boolean;
  readonly rowNumbers: boolean;
  /** Changes when what the cells say may have: the grid is drawn again. */
  readonly stamp: string;
  /** Makes sure the rows from `first` to `last` are read. */
  readonly need: (first: number, last: number) => void;
  /** A cell: what it shows, what is put in the box when it is edited, whether its row's value was typed in it, and whether that is not a number. Undefined while not read. */
  readonly cell: (row: number, column: string) => { readonly shown: string; readonly edited: string; readonly typed: boolean; readonly wrong?: boolean } | undefined;
  readonly selection: Selection;
  readonly onSelection: (selection: Selection) => void;
  /** The table is only looked at: nothing is typed, emptied or pasted, no row is asked for, and the columns have no menu. What follows is then left out. */
  readonly readOnly?: boolean;
  /** Types `text` into a cell. Answers false when it could not be taken: the box stays open. */
  readonly onCommit?: (row: number, column: string, text: string) => Promise<boolean>;
  /** Empties the rows of these runs (from a first to a last row). */
  readonly onClear?: (runs: [number, number][]) => void;
  /** Asks for one more row: the last one was left with Enter or the arrow down. */
  readonly onGrow?: () => void;
  readonly onColumnWidth: (column: string, width: number) => void;
  /** The width of the column of row numbers, once it was given one; and what hears of a new one. */
  readonly numbersWidth: number | null;
  readonly onNumbersWidth: (width: number) => void;
  /** The longest text a column shows, as it is shown: what it is fitted to when the edge of its head is double-clicked. */
  readonly longest: (column: string) => Promise<string>;
  /** A key of the table that is not the grid's own to answer: Ctrl+Z, Ctrl+Y, Ctrl+C, Ctrl+X. */
  readonly onShortcut?: (what: 'undo' | 'redo' | 'copy' | 'cut') => void;
  /** Ctrl+V on the table, not in a cell being edited. What was copied is not read here: it may be millions of rows. */
  readonly onPaste?: () => void;
  /** What the menu of a column holds; `close` puts it away. */
  readonly columnMenu?: (column: string, close: () => void) => ReactNode;
  /** Already translated. */
  readonly labels: { readonly table: string; readonly selectAll: string; readonly columnMenu: string; readonly resize: string; readonly row: (row: number) => string };
}

const ROW = 28;
const HEAD = 36;
/** How wide the column of row numbers is until its numbers need more. */
const USUAL_NUMBERS = 48;
/** What the edge of the column of row numbers is known by while it is dragged. */
const NUMBERS_ID = '#';
/** How wide the menu of a column is, and the room kept between it and the edge of the window. */
const MENU_WIDTH = 196;
const MENU_MARGIN = 8;
/** How wide the line between two columns is to the pointer. */
const LINE = 7;
/** Rows drawn beyond what is in sight, each way. */
const SPARE = 6;
/** The tallest a page can be before browsers stop scrolling it: beyond it, the scroll is scaled. */
const TALLEST = 12_000_000;

interface Editing {
  readonly row: number;
  readonly col: number;
  readonly text: string;
  readonly wrong: boolean;
}

/**
 * The table: rows and columns of cells, drawn only where they are in sight,
 * selected and edited as in a spreadsheet. It knows nothing of units: what
 * the cells say comes from `cell`, what is typed goes to `onCommit`.
 */
/** The room around the title of a head: its padding, its menu, and the gap between them. */
const HEAD_ROOM = 10 + 6 + 24 + 6 + 4;
/** The room around what a cell says: its padding and its border. */
const CELL_ROOM = 10 + 10 + 2;

export function DataGrid({ columns: asked, rowCount: tableRows, endless = false, rowNumbers, stamp, need, cell, selection, onSelection, readOnly, onCommit, onClear, onGrow, onColumnWidth, numbersWidth, onNumbersWidth, longest, onShortcut, onPaste, columnMenu, labels }: DataGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, height: 400, width: 0 });
  /** The letters of the table, as the page draws them: what widths are measured with. */
  const [letters, setLetters] = useState('system-ui');
  const [editing, setEditing] = useState<Editing | null>(null);
  /** The menu of a column that is open, and where it is drawn: right under the button that opened it. */
  const [menu, setMenu] = useState<{ readonly id: string; readonly top: number; readonly left: number } | null>(null);
  const menuBox = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  /** A step down asked for at the last row: taken once the table has one more. */
  const pending = useRef(false);
  /** With `endless`: how far down the empty rows go now. They go further as the table is scrolled towards their end. */
  const [reach, setReach] = useState(0);
  const rowCount = endless && !readOnly ? Math.max(tableRows, reach) : tableRows;
  // The column of row numbers: as wide as it was dragged, else as its longest number needs.
  const NUMBERS = !rowNumbers ? 0 : (numbersWidth ?? Math.max(USUAL_NUMBERS, Math.ceil(textWidth(String(rowCount), `12px ${letters}`)) + 20));
  // The columns as they are drawn: those given no width share the room in sight equally, none narrower than its head.
  // The symbol is written in other letters than the name (see .columnSymbol): each is measured in its own.
  const SYMBOL_LETTERS = "600 13px 'Cascadia Mono', Consolas, ui-monospace, monospace";
  const least = (column: GridColumn) => Math.ceil(textWidth(column.title, `600 14px ${letters}`) + textWidth(column.symbol === '' ? '' : column.title === '' ? column.symbol : ` (${column.symbol})`, SYMBOL_LETTERS)) + HEAD_ROOM + 2;
  const leasts = asked.map(least);
  const drawnWidths = sharedWidths(
    asked.map((column, at) => ({ width: column.width, least: leasts[at] ?? 0 })),
    Math.max(view.width - NUMBERS, 0),
  );
  const columns = asked.map((column, at) => ({ ...column, width: drawnWidths[at] ?? 0 }));
  type Drawn = (typeof columns)[number];
  const bounds = { rows: rowCount, cols: columns.length };

  // How the rows map to the scroll: one to one while the table is short enough, scaled beyond.
  const body = rowCount * ROW;
  const scaled = body > TALLEST;
  const tall = scaled ? TALLEST : body;
  const inSight = Math.max(Math.ceil((view.height - HEAD) / ROW), 1);
  const furthest = Math.max(tall + HEAD - view.height, 1);
  const firstInSight = scaled ? Math.round((Math.min(view.top, furthest) / furthest) * Math.max(rowCount - inSight, 0)) : Math.floor(view.top / ROW);
  const first = Math.max(firstInSight - (scaled ? 0 : SPARE), 0);
  const last = Math.min(firstInSight + inSight + SPARE, rowCount - 1);
  // Rows past the table hold nothing: there is nothing to read of them.
  if (first < tableRows) need(first, Math.min(last, tableRows - 1));
  // Close to the end of the empty rows (or a window taller than all of them): more of them below.
  const wanted = firstInSight + inSight * 3;
  useEffect(() => {
    if (endless && wanted > rowCount) setReach(wanted + inSight * 2);
  }, [endless, wanted, rowCount, inSight]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setView((before) => (before.height === element.clientHeight && before.width === element.clientWidth ? before : { ...before, height: element.clientHeight, width: element.clientWidth }));
    measure();
    setLetters(getComputedStyle(element).fontFamily || 'system-ui');
    const watcher = new ResizeObserver(measure);
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);

  // An open menu goes away with a press anywhere else, with Escape, and when the table moves under it.
  useEffect(() => {
    if (!menu) return;
    const away = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (menuBox.current?.contains(target) || target?.closest?.('[data-column-menu]')) return;
      setMenu(null);
    };
    const escape = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && setMenu(null);
    const moved = () => setMenu(null);
    const element = scroller.current;
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', moved);
    element?.addEventListener('scroll', moved);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', moved);
      element?.removeEventListener('scroll', moved);
    };
  }, [menu !== null]);

  /** Brings a cell into sight. */
  const show = useCallback(
    (place: CellPlace) => {
      const element = scroller.current;
      if (!element) return;
      const rowsShown = Math.max(Math.floor((element.clientHeight - HEAD) / ROW), 1);
      if (scaled) {
        const now = Math.round((Math.min(element.scrollTop, furthest) / furthest) * Math.max(rowCount - rowsShown, 0));
        if (place.row < now || place.row >= now + rowsShown) element.scrollTop = (Math.max(place.row - Math.floor(rowsShown / 2), 0) / Math.max(rowCount - rowsShown, 1)) * furthest;
      } else {
        const top = place.row * ROW;
        if (top < element.scrollTop) element.scrollTop = top;
        else if (top + ROW > element.scrollTop + element.clientHeight - HEAD) element.scrollTop = top + ROW - (element.clientHeight - HEAD);
      }
      // Sideways: only the columns that scroll can be out of sight.
      const column = columns[place.col];
      if (!column || column.held) return;
      const heldStart = NUMBERS + columns.filter((known) => known.held === 'start').reduce((sum, known) => sum + known.width, 0);
      const heldEnd = columns.filter((known) => known.held === 'end').reduce((sum, known) => sum + known.width, 0);
      const left = NUMBERS + columns.slice(0, place.col).reduce((sum, known) => sum + known.width, 0);
      if (left < element.scrollLeft + heldStart) element.scrollLeft = left - heldStart;
      else if (left + column.width > element.scrollLeft + element.clientWidth - heldEnd) element.scrollLeft = left + column.width - (element.clientWidth - heldEnd);
    },
    [drawnWidths.join(','), asked, NUMBERS, rowCount, scaled, furthest],
  );

  const select = (next: Selection, reveal: CellPlace | null = next.active) => {
    onSelection(next);
    if (reveal) show(reveal);
  };

  // One more row came: the step down that waited for it is taken.
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    select(move(selection, { rows: 1, cols: 0 }, bounds));
  }, [rowCount]);

  const step = (by: { rows: number; cols: number }, stretch = false) => {
    if (by.rows > 0 && !stretch && selection.active.row >= rowCount - 1 && !readOnly && (onGrow || endless)) {
      pending.current = true;
      // Endless, the empty rows only go further; else the table is asked for one more.
      if (endless) return setReach(rowCount + Math.max(inSight, 20));
      return onGrow?.();
    }
    const next = move(selection, by, bounds, stretch);
    // While a range is stretched, what is brought into sight is its far corner.
    const range = next.ranges[next.ranges.length - 1];
    const far = stretch && range ? { row: range.top === next.anchor.row ? range.bottom : range.top, col: range.left === next.anchor.col ? range.right : range.left } : next.active;
    select(next, far);
  };

  const startEditing = (place: CellPlace, text: string | null) => {
    const column = columns[place.col];
    if (!column || readOnly) return;
    setEditing({ ...place, text: text ?? cell(place.row, column.id)?.edited ?? '', wrong: false });
  };

  /** Types what is in the box into its cell; false when it was not a number and the box stays. */
  const commit = async (): Promise<boolean> => {
    if (!editing) return true;
    const column = columns[editing.col];
    if (!column) return true;
    const before = cell(editing.row, column.id);
    // Left as it was: nothing is typed, so a cell that was only looked at does not take over its row.
    if (before && editing.text === before.edited) {
      setEditing(null);
      return true;
    }
    const taken = onCommit ? await onCommit(editing.row, column.id, editing.text) : true;
    if (taken) setEditing(null);
    else setEditing((now) => (now ? { ...now, wrong: true } : now));
    return taken;
  };

  const placeOf = (target: EventTarget | null): CellPlace | null => {
    const element = (target as HTMLElement | null)?.closest<HTMLElement>('[data-row][data-col]');
    return element ? { row: Number(element.dataset.row), col: Number(element.dataset.col) } : null;
  };

  const mouseDown = async (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('input')) return;
    const place = placeOf(event.target);
    if (!place) return;
    if (editing && !(await commit())) return;
    scroller.current?.focus({ preventScroll: true });
    if (event.shiftKey) select(stretchTo(selection, place), place);
    else if (event.ctrlKey || event.metaKey) select(toggleCell(selection, place), place);
    else {
      select(selectCell(place));
      dragging.current = true;
    }
  };

  const mouseOver = (event: MouseEvent<HTMLDivElement>) => {
    if (!dragging.current || event.buttons !== 1) return void (dragging.current = false);
    const place = placeOf(event.target);
    if (place) onSelection(stretchTo(selection, place));
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || menu) return;
    const mod = event.ctrlKey || event.metaKey;
    const rowsAPage = Math.max(inSight - 1, 1);
    const moves: Readonly<Record<string, { rows: number; cols: number }>> = {
      // With Ctrl an arrow goes to the edge of the table: the first or last row, the first or last column.
      ArrowUp: { rows: mod ? -rowCount : -1, cols: 0 },
      ArrowDown: { rows: mod ? rowCount : 1, cols: 0 },
      ArrowLeft: { rows: 0, cols: mod ? -columns.length : -1 },
      ArrowRight: { rows: 0, cols: mod ? columns.length : 1 },
      PageUp: { rows: -rowsAPage, cols: 0 },
      PageDown: { rows: rowsAPage, cols: 0 },
      Home: { rows: mod ? -rowCount : 0, cols: -columns.length },
      End: { rows: mod ? rowCount : 0, cols: columns.length },
    };
    const by = moves[event.key];
    if (by) {
      event.preventDefault();
      // Page down and End never ask for a new row: only a step from the last row does.
      if (event.key === 'ArrowDown' && !mod) step(by, event.shiftKey);
      else {
        const next = move(selection, by, bounds, event.shiftKey);
        const range = next.ranges[next.ranges.length - 1];
        select(next, event.shiftKey && range ? { row: range.top === next.anchor.row ? range.bottom : range.top, col: range.left === next.anchor.col ? range.right : range.left } : next.active);
      }
    } else if (event.key === 'Tab') {
      event.preventDefault();
      step({ rows: 0, cols: event.shiftKey ? -1 : 1 });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      step({ rows: event.shiftKey ? -1 : 1, cols: 0 });
    } else if (event.key === 'F2') {
      event.preventDefault();
      startEditing(selection.active, null);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (!readOnly) onClear?.(selectedRowRuns(selection));
    } else if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      onSelection(selectAll(selection, bounds));
    } else if (mod && !event.altKey && ['z', 'y', 'c', 'x'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      const key = event.key.toLowerCase();
      const what = key === 'c' ? 'copy' : key === 'x' ? 'cut' : key === 'y' || event.shiftKey ? 'redo' : 'undo';
      if (!readOnly || what === 'copy') onShortcut?.(what);
    } else if (!mod && !event.altKey && event.key.length === 1) {
      // Typing on the active cell starts it with what was typed.
      event.preventDefault();
      startEditing(selection.active, event.key);
    }
  };

  const editorKey = async (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      setEditing(null);
      scroller.current?.focus({ preventScroll: true });
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      const by = event.key === 'Enter' ? { rows: event.shiftKey ? -1 : 1, cols: 0 } : { rows: 0, cols: event.shiftKey ? -1 : 1 };
      if (await commit()) {
        scroller.current?.focus({ preventScroll: true });
        step(by);
      }
    }
  };

  /**
   * The column whose edge is pointed at or held: the edge in its head and the line under it light up together, as one
   * line from the top of the table to its bottom.
   */
  const [lit, setLit] = useState<string | null>(null);
  const lights = (id: string) => ({
    'data-lit': lit === id,
    onPointerEnter: () => setLit(id),
    onPointerLeave: () => setLit((current) => (current === id ? null : current)),
  });

  // Dragging the edge of a head changes the width of its column.
  const resizing = useRef<{ readonly id: string; readonly from: number; readonly width: number } | null>(null);
  const resizeStart = (event: PointerEvent<HTMLSpanElement>, column: Pick<Drawn, 'id' | 'width'>) => {
    event.preventDefault();
    event.stopPropagation();
    resizing.current = { id: column.id, from: event.clientX, width: column.width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resizeMove = (event: PointerEvent<HTMLSpanElement>) => {
    const from = resizing.current;
    if (!from) return;
    const width = from.width + (event.clientX - from.from);
    if (from.id === NUMBERS_ID) onNumbersWidth(width);
    else onColumnWidth(from.id, width);
  };
  /** A double click on the edge of a head: the column becomes as wide as its longest value needs, and its head. */
  const fit = (column: Drawn, at: number) => {
    void longest(column.id).then(
      (text) => onColumnWidth(column.id, Math.max(Math.ceil(textWidth(text, `700 14px ${letters}`)) + CELL_ROOM, leasts[at] ?? 0)),
      () => {},
    );
  };

  // Where the columns held at an edge stand: each after those held before it.
  const offsets = new Map<string, CSSProperties>();
  let fromStart = NUMBERS;
  for (const column of columns.filter((known) => known.held === 'start')) {
    offsets.set(column.id, { position: 'sticky', left: fromStart, zIndex: 2 });
    fromStart += column.width;
  }
  let fromEnd = 0;
  for (const column of [...columns].reverse().filter((known) => known.held === 'end')) {
    offsets.set(column.id, { position: 'sticky', right: fromEnd, zIndex: 2 });
    fromEnd += column.width;
  }
  const width = NUMBERS + columns.reduce((sum, column) => sum + column.width, 0);
  // Where the lines between columns stand, as the table is scrolled: what is held at the start does not move with it.
  const fitNumbers = () => onNumbersWidth(Math.ceil(textWidth(String(rowCount), `700 12px ${letters}`)) + 20);
  const lines: { readonly id: string; readonly width: number; readonly at: number; readonly fit: () => void }[] = rowNumbers ? [{ id: NUMBERS_ID, width: NUMBERS, at: view.left + NUMBERS, fit: fitNumbers }] : [];
  let across = NUMBERS;
  let heldAcross = NUMBERS;
  columns.forEach((column, at) => {
    across += column.width;
    if (column.held === 'start') heldAcross += column.width;
    // A column held at the end keeps the edge of its head only: its line would stand on the other side of it.
    // So does the last column: its line would stand against the bar the table is scrolled with.
    if (column.held !== 'end' && at < columns.length - 1) lines.push({ id: column.id, width: column.width, at: column.held === 'start' ? view.left + heldAcross : across, fit: () => fit(column, at) });
  });
  const rows: number[] = [];
  for (let row = first; row <= last; row++) rows.push(row);
  /** One cell alone is selected: it is outlined itself. More than one: the outline goes round them all. */
  const alone = selection.ranges.length === 1 && selection.ranges.every((range) => range.top === range.bottom && range.left === range.right);
  // Unscaled, the rows are drawn where they are; scaled, from the top of what is in sight.
  const offset = scaled ? 0 : first * ROW - view.top;

  return (
    <div
      ref={scroller}
      className={styles.scroller}
      tabIndex={0}
      role="grid"
      aria-label={labels.table}
      aria-rowcount={rowCount}
      aria-colcount={columns.length}
      data-stamp={stamp}
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        const left = event.currentTarget.scrollLeft;
        setView((before) => (before.top === top && before.left === left ? before : { ...before, top, left }));
      }}
      onKeyDown={keyDown}
      onPaste={(event) => {
        // Into a cell being edited, a paste is the box's own.
        if (editing || (event.target as HTMLElement).closest('input')) return;
        event.preventDefault();
        if (!readOnly) onPaste?.();
      }}
      onMouseDown={(event) => void mouseDown(event)}
      onMouseOver={mouseOver}
      onMouseUp={() => (dragging.current = false)}
      onDoubleClick={(event) => {
        const place = placeOf(event.target);
        if (place && !editing) startEditing(place, null);
      }}
    >
      <div className={styles.sizer} style={{ height: tall + HEAD, width }}>
        <div className={styles.window} style={{ height: view.height, width }}>
          <div className={styles.head} style={{ height: HEAD }} role="row">
            {rowNumbers && (
              <div className={styles.corner} style={{ width: NUMBERS }}>
                <button type="button" className={styles.cornerButton} aria-label={labels.selectAll} data-tooltip={labels.selectAll} onClick={() => onSelection(selectAll(selection, bounds))}>
                  #
                </button>
                <span
                  className={styles.edge}
                  data-edge
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={labels.resize}
                  {...lights(NUMBERS_ID)}
                  onPointerDown={(event) => resizeStart(event, { id: NUMBERS_ID, width: NUMBERS })}
                  onPointerMove={resizeMove}
                  onPointerUp={() => (resizing.current = null)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    fitNumbers();
                  }}
                />
              </div>
            )}
            {columns.map((column, col) => (
              <div
                key={column.id}
                className={styles.columnHead}
                role="columnheader"
                data-selected={isColumnSelected(selection, col, bounds)}
                data-held={column.held ?? undefined}
                style={{ width: column.width, ...offsets.get(column.id) }}
                onMouseDown={(event) => {
                  // The head selects its column; its menu and its edge do their own thing.
                  if (event.button !== 0 || (event.target as HTMLElement).closest('button, [data-edge]')) return;
                  event.stopPropagation();
                  scroller.current?.focus({ preventScroll: true });
                  onSelection(selectColumns(selection, col, bounds, event.shiftKey ? 'stretch' : event.ctrlKey || event.metaKey ? 'add' : 'only'));
                }}
              >
                <span className={styles.columnTitle}>
                  {column.title}
                  {column.symbol !== '' && (
                    <>
                      {column.title !== '' && ' '}
                      <span className={styles.columnSymbol} dir="ltr" style={{ color: column.color }}>
                        {column.title !== '' ? `(${column.symbol})` : column.symbol}
                      </span>
                    </>
                  )}
                </span>
                {columnMenu && !readOnly && (
                <button
                  type="button"
                  className={styles.columnMenu}
                  data-column-menu
                  aria-label={labels.columnMenu}
                  aria-haspopup="menu"
                  aria-expanded={menu?.id === column.id}
                  data-tooltip={menu?.id === column.id ? undefined : labels.columnMenu}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    if (menu?.id === column.id) return setMenu(null);
                    // Under the button, its end lined up with the button's; never out of the window.
                    const box = event.currentTarget.getBoundingClientRect();
                    setMenu({ id: column.id, top: box.bottom + 4, left: Math.max(Math.min(box.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - MENU_MARGIN), MENU_MARGIN) });
                  }}
                >
                  <span aria-hidden="true">⋮</span>
                </button>
                )}
                <span className={styles.edge} data-edge role="separator" aria-orientation="vertical" aria-label={labels.resize} {...lights(column.id)} onPointerDown={(event) => resizeStart(event, column)} onPointerMove={resizeMove} onPointerUp={() => (resizing.current = null)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    fit(column, col);
                  }}
                />
              </div>
            ))}
          </div>
          {/* The line between two columns, down the whole table: dragged like the edge of the head, and fitted with a double click. */}
          {lines.map((line) => (
            <span
              key={line.id}
              className={styles.line}
              style={{ left: line.at - LINE / 2, top: HEAD }}
              role="separator"
              aria-orientation="vertical"
              aria-label={labels.resize}
              {...lights(line.id)}
              onPointerDown={(event) => resizeStart(event, line)}
              onPointerMove={resizeMove}
              onPointerUp={() => (resizing.current = null)}
              onMouseDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => {
                event.stopPropagation();
                line.fit();
              }}
            />
          ))}
          <div className={styles.rows} style={{ transform: `translateY(${offset}px)` }}>
            {rows.map((row) => (
              <div key={row} className={styles.row} role="row" aria-rowindex={row + 1} style={{ height: ROW }}>
                {rowNumbers && (
                  <div
                    className={styles.number}
                    style={{ width: NUMBERS }}
                    role="rowheader"
                    aria-label={labels.row(row + 1)}
                    data-selected={isRowSelected(selection, row, bounds)}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      event.stopPropagation();
                      scroller.current?.focus({ preventScroll: true });
                      onSelection(selectRows(selection, row, bounds, event.shiftKey ? 'stretch' : event.ctrlKey || event.metaKey ? 'add' : 'only'));
                    }}
                  >
                    {row + 1}
                  </div>
                )}
                {columns.map((column, col) => {
                  const read = cell(row, column.id);
                  const active = selection.active.row === row && selection.active.col === col;
                  // The selection is outlined on its outside: a cell at an edge of a range draws that edge.
                  const edges = alone
                    ? []
                    : selection.ranges.flatMap((range) =>
                        row < range.top || row > range.bottom || col < range.left || col > range.right
                          ? []
                          : [row === range.top ? 'inset 0 2px 0 var(--sc-accent)' : '', row === range.bottom ? 'inset 0 -2px 0 var(--sc-accent)' : '', col === range.left ? 'inset 2px 0 0 var(--sc-accent)' : '', col === range.right ? 'inset -2px 0 0 var(--sc-accent)' : ''].filter(Boolean),
                      );
                  const edited = editing && editing.row === row && editing.col === col ? editing : null;
                  return (
                    <div key={column.id} className={styles.cell} role="gridcell" data-row={row} data-col={col} data-selected={isSelected(selection, row, col)} data-active={active && alone} data-first={(active && !alone) || undefined} data-typed={read?.typed === true} data-wrong={read?.wrong === true || undefined} data-text={column.text === true || undefined} data-from-start={column.fromStart === true || undefined} data-held={column.held ?? undefined} style={{ width: column.width, ...offsets.get(column.id), ...(edges.length > 0 ? { boxShadow: edges.join(', ') } : null) }}>
                      {edited ? (
                        <input
                          className={styles.editor}
                          autoFocus
                          dir="ltr"
                          spellCheck={false}
                          value={edited.text}
                          data-wrong={edited.wrong}
                          aria-invalid={edited.wrong}
                          onChange={(event) => setEditing({ ...edited, text: event.target.value, wrong: false })}
                          onKeyDown={(event) => void editorKey(event)}
                          onBlur={() => void commit()}
                          // The box starts with the cursor after what is in it, as typing on a cell does.
                          onFocus={(event) => event.target.setSelectionRange(event.target.value.length, event.target.value.length)}
                        />
                      ) : (
                        <span dir="ltr">{read?.shown ?? ''}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {menu &&
        columnMenu &&
        createPortal(
          <div ref={menuBox} className={styles.menu} role="menu" style={{ top: menu.top, left: menu.left, width: MENU_WIDTH }}>
            {columnMenu(menu.id, () => setMenu(null))}
          </div>,
          document.body,
        )}
    </div>
  );
}
