import { describe, expect, it } from 'vitest';
import { isColumnSelected, isRowSelected, isSelected, kept, move, selectAll, selectCell, selectColumns, selectedCount, selectedRowRuns, selectRows, stretchTo, toggleCell } from './selection';

const bounds = { rows: 10, cols: 4 };

describe('what is selected in the table', () => {
  it('selects one cell, then stretches to another with Shift', () => {
    const one = selectCell({ row: 2, col: 1 });
    expect(selectedCount(one)).toBe(1);
    const range = stretchTo(one, { row: 4, col: 3 });
    expect(range.active).toEqual({ row: 2, col: 1 });
    expect(selectedCount(range)).toBe(9);
    expect(isSelected(range, 3, 2)).toBe(true);
    expect(isSelected(range, 5, 2)).toBe(false);
    // Stretched the other way: from the same anchor.
    expect(stretchTo(range, { row: 0, col: 0 }).ranges).toEqual([{ top: 0, left: 0, bottom: 2, right: 1 }]);
  });

  it('adds and takes out single cells with Ctrl', () => {
    const two = toggleCell(selectCell({ row: 0, col: 0 }), { row: 5, col: 2 });
    expect(selectedCount(two)).toBe(2);
    expect(two.active).toEqual({ row: 5, col: 2 });
    const back = toggleCell(two, { row: 5, col: 2 });
    expect(back.ranges).toEqual([{ top: 0, left: 0, bottom: 0, right: 0 }]);
    // The only cell selected stays selected.
    expect(toggleCell(back, { row: 0, col: 0 })).toBe(back);
  });

  it('selects rows, columns and the whole table', () => {
    const row = selectRows(selectCell({ row: 0, col: 0 }), 3, bounds, 'only');
    expect(isRowSelected(row, 3, bounds)).toBe(true);
    expect(selectedCount(row)).toBe(4);
    const rows = selectRows(row, 6, bounds, 'stretch');
    expect(selectedRowRuns(rows)).toEqual([[3, 6]]);
    const more = selectRows(rows, 9, bounds, 'add');
    expect(selectedRowRuns(more)).toEqual([[3, 6], [9, 9]]);
    const column = selectColumns(selectCell({ row: 0, col: 0 }), 2, bounds, 'only');
    expect(isColumnSelected(column, 2, bounds)).toBe(true);
    expect(isColumnSelected(column, 1, bounds)).toBe(false);
    expect(selectedCount(selectAll(column, bounds))).toBe(40);
  });

  it('moves with the keys and stays inside the table', () => {
    const start = selectCell({ row: 0, col: 0 });
    expect(move(start, { rows: -1, cols: 0 }, bounds).active).toEqual({ row: 0, col: 0 });
    expect(move(start, { rows: 1, cols: 1 }, bounds).active).toEqual({ row: 1, col: 1 });
    expect(move(selectCell({ row: 9, col: 3 }), { rows: 1, cols: 1 }, bounds).active).toEqual({ row: 9, col: 3 });
    // Shift+arrows grow the range from where it started, and shrink it again.
    const grown = move(move(start, { rows: 1, cols: 0 }, bounds, true), { rows: 1, cols: 0 }, bounds, true);
    expect(grown.ranges).toEqual([{ top: 0, left: 0, bottom: 2, right: 0 }]);
    expect(move(grown, { rows: -1, cols: 0 }, bounds, true).ranges).toEqual([{ top: 0, left: 0, bottom: 1, right: 0 }]);
    expect(grown.active).toEqual({ row: 0, col: 0 });
  });

  it('joins the rows that touch', () => {
    const selection = { ...selectCell({ row: 0, col: 0 }), ranges: [{ top: 4, left: 0, bottom: 6, right: 1 }, { top: 0, left: 2, bottom: 1, right: 2 }, { top: 2, left: 0, bottom: 3, right: 0 }, { top: 9, left: 0, bottom: 9, right: 0 }] };
    expect(selectedRowRuns(selection)).toEqual([[0, 6], [9, 9]]);
  });

  it('stays inside a table that got smaller', () => {
    const selection = stretchTo(selectCell({ row: 8, col: 3 }), { row: 2, col: 1 });
    const smaller = kept(selection, { rows: 5, cols: 2 });
    expect(smaller.active).toEqual({ row: 4, col: 1 });
    expect(smaller.ranges).toEqual([{ top: 2, left: 1, bottom: 4, right: 1 }]);
  });
});
