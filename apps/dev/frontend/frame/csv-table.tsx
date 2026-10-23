import { DataGrid, NOTHING_SELECTED } from '@syntelab/data-grid';
import type { GridColumn, Selection } from '@syntelab/data-grid';
import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { problemKey } from '../api/dev-api';
import styles from './csv-table.module.css';
import type { ToolInput } from './text-tool';

export interface CsvTableProps {
  readonly host: Pick<AppHost, 'invoke'>;
  /** The CSV to show: a text, or a file read from where it is. Null while there is none. */
  readonly source: ToolInput | null;
  /** The sign between the fields: `,`, `;`, `tab`, `|`, or `auto` to tell it from the first row. */
  readonly separator: string;
  /** The first row holds the names of the columns. */
  readonly header: boolean;
}

/** What the `csv_open` command of the Rust side answers. */
interface Opened {
  readonly table: number;
  readonly rows: number;
  readonly columns: number;
  readonly names: readonly string[];
  readonly longest: readonly string[];
  readonly separator: string;
}

/** Rows are read and kept in blocks of this many; and the most blocks kept (those read longest ago go first). */
const BLOCK = 100;
const MOST_BLOCKS = 60;
const NARROWEST = 48;
const WIDEST = 900;

/**
 * CSV as a table, to look at: the rows and columns of the suite's grid,
 * read only. The Rust side reads the text once and keeps where its rows
 * begin; the rows in sight are asked for a block at a time, so a file of
 * any size is shown the same way. Nothing is refused here: what is wrong
 * with a CSV is told by the tool when it converts.
 */
export function CsvTable({ host, source, separator, header }: CsvTableProps) {
  const { t, language } = useI18n();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [selection, setSelection] = useState<Selection>(NOTHING_SELECTED);
  const [widths, setWidths] = useState<Readonly<Record<string, number>>>({});
  const [numbersWidth, setNumbersWidth] = useState<number | null>(null);
  const [, redraw] = useState(0);
  const blocks = useRef(new Map<number, readonly (readonly string[])[]>());
  const asked = useRef(new Set<number>());
  const held = useRef<number | null>(null);

  // The table is asked for anew whenever the text or how it is read changes, and the one before it is let go.
  useEffect(() => {
    let current = true;
    const close = () => {
      if (held.current !== null) void host.invoke('csv_close', { table: held.current }).catch(() => {});
      held.current = null;
    };
    close();
    blocks.current.clear();
    asked.current.clear();
    setOpened(null);
    setProblem(null);
    setSelection(NOTHING_SELECTED);
    setWidths({});
    if (source === null) return;
    setReading(true);
    host.invoke<Opened>('csv_open', { ...source, separator, header }).then(
      (answer) => {
        if (!current) return void host.invoke('csv_close', { table: answer.table }).catch(() => {});
        held.current = answer.table;
        setOpened(answer);
        setReading(false);
      },
      (error: unknown) => {
        if (!current) return;
        setProblem(problemKey(error));
        setReading(false);
      },
    );
    return () => {
      current = false;
      close();
    };
  }, [host.invoke, source, separator, header]);

  const table = opened?.table ?? null;
  const need = useCallback(
    (first: number, last: number) => {
      if (table === null) return;
      for (let block = Math.floor(Math.max(first, 0) / BLOCK); block <= Math.floor(Math.max(last, 0) / BLOCK); block++) {
        if (blocks.current.has(block) || asked.current.has(block)) continue;
        asked.current.add(block);
        host.invoke<{ rows: string[][] }>('csv_rows', { table, from: block * BLOCK, count: BLOCK }).then(
          (answer) => {
            asked.current.delete(block);
            // An answer for a table that is no longer the one shown is dropped.
            if (held.current !== table) return;
            blocks.current.set(block, answer.rows);
            while (blocks.current.size > MOST_BLOCKS) blocks.current.delete(blocks.current.keys().next().value as number);
            redraw((count) => count + 1);
          },
          () => asked.current.delete(block),
        );
      }
    },
    [host.invoke, table],
  );

  const columns = useMemo(
    (): GridColumn[] =>
      Array.from({ length: opened?.columns ?? 0 }, (_, at) => {
        const name = opened?.names[at]?.trim() ?? '';
        return { id: String(at), title: name === '' ? t('dev.table.column', { number: at + 1 }) : name, symbol: '', width: widths[String(at)] ?? null, text: true, fromStart: true, held: null };
      }),
    [opened, widths, t],
  );

  if (problem !== null) return <p className={styles.note} data-problem="true">{t(problem)}</p>;
  if (source === null) return <p className={styles.note}>{t('dev.table.empty')}</p>;
  if (reading || opened === null) return <p className={styles.note}>{t('dev.table.reading')}</p>;
  if (opened.rows === 0 || opened.columns === 0) return <p className={styles.note}>{t('dev.table.noRows')}</p>;

  const count = (value: number) => new Intl.NumberFormat(language).format(value);
  return (
    <div className={styles.table}>
      <p className={styles.facts}>{t('dev.table.facts', { rows: count(opened.rows), columns: count(opened.columns), separator: opened.separator })}</p>
      <div className={styles.grid}>
        <DataGrid
          readOnly
          columns={columns}
          rowCount={opened.rows}
          rowNumbers
          stamp={String(opened.table)}
          need={need}
          cell={(row, column) => {
            const read = blocks.current.get(Math.floor(row / BLOCK))?.[row % BLOCK];
            if (!read) return undefined;
            const text = read[Number(column)] ?? '';
            return { shown: text, edited: text, typed: false };
          }}
          selection={selection}
          onSelection={setSelection}
          onColumnWidth={(id, width) => setWidths((before) => ({ ...before, [id]: Math.min(Math.max(Math.round(width), NARROWEST), WIDEST) }))}
          numbersWidth={numbersWidth}
          onNumbersWidth={(width) => setNumbersWidth(Math.min(Math.max(Math.round(width), 32), 240))}
          longest={async (id) => opened.longest[Number(id)] ?? ''}
          labels={{ table: t('dev.table.label'), selectAll: t('dev.table.selectAll'), columnMenu: '', resize: t('dev.table.resize'), row: (row) => t('dev.table.row', { row }) }}
        />
      </div>
    </div>
  );
}
