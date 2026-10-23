import type { AppHost } from '@syntelab/shell-api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readRows } from './table-api';
import type { ShownRow, Writing } from './table-api';

/** Rows are read and kept in blocks of this many. */
const BLOCK = 100;
/** The most blocks kept: the ones read longest ago go first. */
const MOST_BLOCKS = 60;

/**
 * The rows of a table that are in sight, read from the Rust side a block at a
 * time and kept while they stay near. Nothing is kept of a table as a whole:
 * a table of millions of rows is read only where it is looked at.
 *
 * `version` changes whenever a value of the table does: everything read
 * before is then read again, in place, without the table going blank.
 */
export function useRows(host: Pick<AppHost, 'invoke'>, table: string | null, writing: Writing, version: number) {
  const blocks = useRef(new Map<number, { readonly rows: readonly ShownRow[]; readonly stamp: string; readonly units: readonly string[] }>());
  const asked = useRef(new Set<string>());
  const [, redraw] = useState(0);
  // What the rows were read for: other columns, other decimals or another value make them old.
  const stamp = `${table}|${version}|${writing.units.join(',')}|${JSON.stringify(writing.decimals)}|${writing.extremes}`;
  const latest = useRef({ stamp, writing, table });
  latest.current = { stamp, writing, table };

  useEffect(() => {
    // Another table: nothing read before is of it.
    blocks.current.clear();
    asked.current.clear();
  }, [table]);

  const read = useCallback(
    (block: number) => {
      const { stamp: wanted, writing: how, table: name } = latest.current;
      if (name === null || how.units.length === 0) return;
      const key = `${block}|${wanted}`;
      if (asked.current.has(key)) return;
      asked.current.add(key);
      readRows(host, name, block * BLOCK, BLOCK, how).then(
        (answer) => {
          // Asked and answered: when the block is dropped later (only so many are kept), it can be asked for again.
          // Without this, rows scrolled far away from never came back.
          asked.current.delete(key);
          // An answer that is no longer the newest for its block is dropped.
          if (latest.current.stamp !== wanted) return;
          blocks.current.delete(block);
          blocks.current.set(block, { rows: answer.rows, stamp: wanted, units: how.units });
          while (blocks.current.size > MOST_BLOCKS) blocks.current.delete(blocks.current.keys().next().value as number);
          redraw((count) => count + 1);
        },
        () => asked.current.delete(key),
      );
    },
    [host.invoke],
  );

  /** Makes sure the rows from `first` to `last` are read, or being read. Called while drawing. */
  const need = useCallback(
    (first: number, last: number) => {
      for (let block = Math.floor(Math.max(first, 0) / BLOCK); block <= Math.floor(Math.max(last, 0) / BLOCK); block++) {
        if (blocks.current.get(block)?.stamp !== latest.current.stamp) read(block);
      }
    },
    [read],
  );

  /**
   * A cell as it was last read: its text in plain digits (empty for an empty row), whether it is the cell the
   * row's value was typed in, and whether what was typed there is not a number. Undefined while it has not been read. An old reading is shown until the new one
   * comes; a column that was not in it yet stays blank until then.
   */
  const cellAt = useCallback((row: number, unit: string): { readonly text: string; readonly typed: boolean; readonly wrong: boolean } | undefined => {
    const block = blocks.current.get(Math.floor(row / BLOCK));
    const read = block?.rows[row % BLOCK];
    if (!block || !read) return undefined;
    if (read.driver === null) return { text: '', typed: false, wrong: false };
    const at = block.units.indexOf(unit);
    return at < 0 ? undefined : { text: read.cells[at] ?? '', typed: read.driver === unit, wrong: read.wrong === true && read.driver === unit };
  }, []);

  return { need, cellAt, stamp };
}
