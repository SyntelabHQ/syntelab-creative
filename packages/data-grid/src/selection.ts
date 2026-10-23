/**
 * What is selected in the table, as a spreadsheet does it: one cell is the
 * active one (where typing goes), and any number of rectangles of cells are
 * selected. A row, a column and the whole table are rectangles too.
 */

export interface CellPlace {
  readonly row: number;
  readonly col: number;
}

/** A rectangle of cells; both corners are in it. */
export interface CellRange {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

export interface Selection {
  /** Where typing goes; the cell the keys move from. */
  readonly active: CellPlace;
  /** Where the range being stretched started: Shift+click and Shift+arrows stretch from here. */
  readonly anchor: CellPlace;
  /** What is selected. The last one is the one being stretched. */
  readonly ranges: readonly CellRange[];
}

/** How far the table goes: the keys never leave it. */
export interface Bounds {
  readonly rows: number;
  readonly cols: number;
}

const between = (one: CellPlace, other: CellPlace): CellRange => ({ top: Math.min(one.row, other.row), left: Math.min(one.col, other.col), bottom: Math.max(one.row, other.row), right: Math.max(one.col, other.col) });
const inside = (place: CellPlace, bounds: Bounds): CellPlace => ({ row: Math.min(Math.max(place.row, 0), Math.max(bounds.rows - 1, 0)), col: Math.min(Math.max(place.col, 0), Math.max(bounds.cols - 1, 0)) });

/** One cell selected, and active. */
export function selectCell(place: CellPlace): Selection {
  return { active: place, anchor: place, ranges: [between(place, place)] };
}

export const NOTHING_SELECTED: Selection = selectCell({ row: 0, col: 0 });

/** Shift+click, or dragging: the range being stretched now ends at `place`. The active cell stays. */
export function stretchTo(selection: Selection, place: CellPlace): Selection {
  return { ...selection, ranges: [...selection.ranges.slice(0, -1), between(selection.anchor, place)] };
}

/** Ctrl+click: the cell is added to what is selected, or taken out when it was the only thing its range held. */
export function toggleCell(selection: Selection, place: CellPlace): Selection {
  const alone = selection.ranges.findIndex((range) => range.top === place.row && range.bottom === place.row && range.left === place.col && range.right === place.col);
  // The only cell selected stays selected: something always is.
  if (alone >= 0 && selection.ranges.length === 1) return selection;
  if (alone >= 0) {
    const ranges = selection.ranges.filter((_, index) => index !== alone);
    const last = ranges[ranges.length - 1] as CellRange;
    const active = { row: last.top, col: last.left };
    return { active, anchor: active, ranges };
  }
  return { active: place, anchor: place, ranges: [...selection.ranges, between(place, place)] };
}

/** A whole row, a whole column, or the whole table: `add` keeps what was selected (Ctrl), `stretch` goes from the anchor (Shift). */
export function selectRows(selection: Selection, row: number, bounds: Bounds, how: 'only' | 'add' | 'stretch'): Selection {
  const first = how === 'stretch' ? selection.anchor.row : row;
  const range: CellRange = { top: Math.min(first, row), bottom: Math.max(first, row), left: 0, right: Math.max(bounds.cols - 1, 0) };
  const place = { row, col: 0 };
  if (how === 'stretch') return { ...selection, ranges: [...selection.ranges.slice(0, -1), range] };
  return { active: place, anchor: place, ranges: how === 'add' ? [...selection.ranges, range] : [range] };
}

export function selectColumns(selection: Selection, col: number, bounds: Bounds, how: 'only' | 'add' | 'stretch'): Selection {
  const first = how === 'stretch' ? selection.anchor.col : col;
  const range: CellRange = { left: Math.min(first, col), right: Math.max(first, col), top: 0, bottom: Math.max(bounds.rows - 1, 0) };
  const place = { row: 0, col };
  if (how === 'stretch') return { ...selection, ranges: [...selection.ranges.slice(0, -1), range] };
  return { active: place, anchor: place, ranges: how === 'add' ? [...selection.ranges, range] : [range] };
}

export function selectAll(selection: Selection, bounds: Bounds): Selection {
  return { ...selection, ranges: [{ top: 0, left: 0, bottom: Math.max(bounds.rows - 1, 0), right: Math.max(bounds.cols - 1, 0) }] };
}

/** An arrow, Tab or Enter: the active cell moves; with `stretch` (Shift+arrow) the range grows from the anchor instead. */
export function move(selection: Selection, by: { readonly rows: number; readonly cols: number }, bounds: Bounds, stretch = false): Selection {
  if (stretch) {
    // What moves is the far corner of the range being stretched.
    const last = selection.ranges[selection.ranges.length - 1] ?? between(selection.anchor, selection.anchor);
    const far = { row: last.top === selection.anchor.row ? last.bottom : last.top, col: last.left === selection.anchor.col ? last.right : last.left };
    return stretchTo(selection, inside({ row: far.row + by.rows, col: far.col + by.cols }, bounds));
  }
  return selectCell(inside({ row: selection.active.row + by.rows, col: selection.active.col + by.cols }, bounds));
}

export function isSelected(selection: Selection, row: number, col: number): boolean {
  return selection.ranges.some((range) => row >= range.top && row <= range.bottom && col >= range.left && col <= range.right);
}

/** Whether every cell of a row (of a column) is selected by one range: its number (its head) is shown as selected. */
export function isRowSelected(selection: Selection, row: number, bounds: Bounds): boolean {
  return selection.ranges.some((range) => row >= range.top && row <= range.bottom && range.left === 0 && range.right >= bounds.cols - 1);
}

export function isColumnSelected(selection: Selection, col: number, bounds: Bounds): boolean {
  return selection.ranges.some((range) => col >= range.left && col <= range.right && range.top === 0 && range.bottom >= bounds.rows - 1);
}

/** How many cells are selected. Ranges that overlap count their shared cells once only when they are the same range. */
export function selectedCount(selection: Selection): number {
  const seen = new Set<string>();
  let count = 0;
  for (const range of selection.ranges) {
    const key = `${range.top}:${range.left}:${range.bottom}:${range.right}`;
    if (seen.has(key)) continue;
    seen.add(key);
    count += (range.bottom - range.top + 1) * (range.right - range.left + 1);
  }
  return count;
}

/** The rows that have a selected cell, as runs from a first to a last row, in order and joined where they touch. */
export function selectedRowRuns(selection: Selection): [number, number][] {
  const runs = selection.ranges.map((range): [number, number] => [range.top, range.bottom]).sort((one, other) => one[0] - other[0]);
  const joined: [number, number][] = [];
  for (const run of runs) {
    const last = joined[joined.length - 1];
    if (last && run[0] <= last[1] + 1) last[1] = Math.max(last[1], run[1]);
    else joined.push([run[0], run[1]]);
  }
  return joined;
}

/** The selection kept inside a table that got smaller. */
export function kept(selection: Selection, bounds: Bounds): Selection {
  const active = inside(selection.active, bounds);
  const ranges = selection.ranges.filter((range) => range.top < bounds.rows && range.left < bounds.cols).map((range) => ({ ...range, bottom: Math.min(range.bottom, bounds.rows - 1), right: Math.min(range.right, bounds.cols - 1) }));
  return ranges.length === 0 ? selectCell(active) : { active, anchor: inside(selection.anchor, bounds), ranges };
}

/** The columns that have a selected cell, in order. */
export function selectedColumns(selection: Selection): number[] {
  const columns = new Set<number>();
  for (const range of selection.ranges) for (let col = range.left; col <= range.right; col++) columns.add(col);
  return [...columns].sort((one, other) => one - other);
}
