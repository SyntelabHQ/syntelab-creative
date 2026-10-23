import type { AppHost } from '@syntelab/shell-api';
import type { Extremes } from '../engine/units-api';

type Invoker = Pick<AppHost, 'invoke'>;

/** What is known of a table at a glance. */
export interface TableFacts {
  /** How long it is. */
  readonly rows: number;
  /** How many rows have a value. */
  readonly filled: number;
  /** How many rows hold something that is not a number. */
  readonly wrong: number;
  /** The last row that has a value, from 0; null when the table is empty. */
  readonly lastFilled: number | null;
  /** There is a change to take back, and one to make again. */
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/** One row as it is shown. */
export interface ShownRow {
  /** The unit the value was typed in; null for an empty row. */
  readonly driver: string | null;
  /** One text for each column asked for, in plain digits; empty for an empty row. */
  readonly cells: readonly string[];
  /** What was typed is not a number: only its own cell says anything. */
  readonly wrong?: boolean;
}

/** How the columns are written. */
export interface Writing {
  readonly units: readonly string[];
  /** Decimals asked for, by unit, over those of the units. */
  readonly decimals: Readonly<Record<string, number>>;
  readonly extremes: Extremes;
}

export const openTable = (host: Invoker, table: string, converter: string) => host.invoke<TableFacts>('table_open', { table, converter });
export const closeTable = (host: Invoker, table: string) => host.invoke<unknown>('table_close', { table });
export const setCell = (host: Invoker, table: string, row: number, unit: string, value: string, decimalMark: string) => host.invoke<{ ambiguous: boolean; wrong: boolean; facts: TableFacts }>('table_set', { table, row, unit, value, decimalMark });
/** Empties rows. Refused with the code `no-memory-to-undo` when the table cannot be kept as it was; `noUndo` empties them without a way back. */
export const clearRows = (host: Invoker, table: string, what: { readonly runs?: readonly (readonly [number, number])[]; readonly all?: boolean; readonly noUndo?: boolean }) => host.invoke<TableFacts>('table_clear', { table, ...what });
export const resizeTable = (host: Invoker, table: string, rows: number) => host.invoke<TableFacts>('table_resize', { table, rows });
/** The longest text each column shows, in the order of `writing.units`. */
export const longestCells = async (host: Invoker, table: string, writing: Writing) => (await host.invoke<{ longest: string[] }>('table_longest', { table, ...writing })).longest;
export const readRows = (host: Invoker, table: string, from: number, count: number, writing: Writing) => host.invoke<{ from: number; rows: ShownRow[] }>('table_rows', { table, from, count, ...writing });

export const undoTable = (host: Invoker, table: string) => host.invoke<{ done: boolean; facts: TableFacts }>('table_undo', { table });
export const redoTable = (host: Invoker, table: string) => host.invoke<{ done: boolean; facts: TableFacts }>('table_redo', { table });

/** What is written of a table when it is copied or exported. */
export interface TableOut extends Writing {
  /** The titles of the columns, in the order of `units`; left out for no titles. */
  readonly titles?: readonly string[];
  readonly rowNumbers: boolean;
  /** Rows become columns and columns rows. */
  readonly transposed: boolean;
  /** The rows wanted, as runs from a first to a last; left out for every row down to the last that has a value. */
  readonly runs?: readonly (readonly [number, number])[];
  /** The mark written before decimals. */
  readonly decimalMark: string;
}

export type TextFormat = 'tsv' | 'csv' | 'json';
export type FileFormat = TextFormat | 'excel';

/** A table as text, put on the clipboard of the system: as much of it as the computer has memory for. */
export const copyTable = (host: Invoker, table: string, out: TableOut, format: TextFormat) => host.invoke<{ rows: number }>('table_text', { table, ...out, format, clipboard: true });
/** A table written to a file. */
export const exportTable = (host: Invoker, table: string, out: TableOut, format: FileFormat, path: string) => host.invoke<{ rows: number }>('table_export', { table, ...out, format, path });

/** Where rows of cells go in a table. */
export interface TableIn {
  /** The units of the columns the cells go to when no titles say: from the active column on. */
  readonly columns: readonly string[];
  /** What a column may be titled with, and the unit that is. */
  readonly names: Readonly<Record<string, string>>;
  readonly transposed: boolean;
  readonly decimalMark: string;
}

/** What became of rows of cells. */
export interface Pasted {
  /** Rows that took a value; of them, those where what was written is not a number. */
  readonly rows: number;
  readonly wrong: number;
  /** The units the cells went to: with titles, they may not be columns of the table yet. */
  readonly units: readonly string[];
  readonly titled: boolean;
  /** Columns that had nowhere to go. */
  readonly leftOut: number;
  /** The user stopped it halfway. The table is then as it was (`rows` is 0), unless it was changed without a way back. */
  readonly stopped: boolean;
  readonly facts: TableFacts;
}

/**
 * Rows into a table have no most: the table is as long as the computer has memory for. They are refused with the code
 * `no-memory` when it has none left (the detail is the bytes asked for), and with `no-memory-to-undo` when the rows
 * would fit but the table as it was, kept so the change could be undone, would not: `noUndo` makes the change without.
 */

/** What the clipboard of the system holds, put into a table from `row` down. */
export const pasteClipboard = (host: Invoker, table: string, row: number, into: TableIn, noUndo = false) => host.invoke<Pasted>('table_paste', { table, clipboard: true, row, ...into, noUndo });
/** A file read into a table, in the place of what it held. */
export const importFile = (host: Invoker, table: string, path: string, kind: 'excel' | 'csv' | 'tsv' | 'auto', into: TableIn, noUndo = false) => host.invoke<Pasted>('table_import', { table, path, kind, ...into, noUndo });

/** How far the long work that is running has got (a paste, an import, an export, a copy of very many rows). */
export interface Progress {
  readonly running: boolean;
  /** Rows done, of how many; `total` is 0 while what is to be read is still being read. */
  readonly done: number;
  readonly total: number;
}

export const workProgress = (host: Invoker) => host.invoke<Progress>('progress');
/** Asks the long work that is running to stop: it answers as stopped (a paste, an import) or fails with the code `stopped`. */
export const stopWork = (host: Invoker) => host.invoke<unknown>('stop');
