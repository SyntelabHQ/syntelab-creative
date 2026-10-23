import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useRef, useState } from 'react';
import { problemKey } from '../api/dev-api';
import styles from './diff-sides.module.css';

/** One side of a row: the number of its line, and its text in pieces (those only this side has are marked). */
interface Side {
  readonly number: number;
  readonly pieces: readonly { readonly text: string; readonly changed: boolean }[];
}

/** A row of the comparison as the Rust side gives it: lines that are passed over, or a line of each side. */
type Row = { readonly skipped: number } | { readonly kind: 'same' | 'added' | 'removed' | 'changed'; readonly left: Side | null; readonly right: Side | null };

export interface DiffSidesProps {
  readonly host: Pick<AppHost, 'invoke'>;
  /** The number the Rust side holds the comparison under; null while there is none. */
  readonly diff: number | null;
  /** How many rows it has in all. */
  readonly rows: number;
  /** Long lines are broken to the width of their side; else each side is scrolled sideways. */
  readonly wrap: boolean;
}

/** Rows are asked for, and drawn, so many at a time. A comparison has no most: the rest is asked for as it is wanted. */
const PAGE = 500;

function SideCells({ side, kind, sign }: { readonly side: Side | null; readonly kind: string; readonly sign: string }) {
  return (
    <>
      <span className={styles.number} data-kind={side ? kind : 'none'}>
        {side?.number ?? ''}
      </span>
      <span className={styles.text} data-kind={side ? kind : 'none'} dir="ltr">
        {side && <span className={styles.sign}>{sign}</span>}
        {side?.pieces.map((piece, at) => (piece.changed && kind.startsWith('changed') ? <mark key={at}>{piece.text}</mark> : <span key={at}>{piece.text}</span>))}
      </span>
    </>
  );
}

/**
 * Two texts side by side: each line of the one beside the line of the other
 * it stands for, with what was taken out on the left, what was put in on
 * the right, and the words that changed marked inside a line that was
 * changed. The comparison is held by the Rust side and asked for a part at
 * a time, so one of any length is shown the same way.
 */
export function DiffSides({ host, diff, rows: total, wrap }: DiffSidesProps) {
  const { t, language } = useI18n();
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const shown = useRef<number | null>(null);

  const more = (from: number) => {
    if (diff === null) return;
    setReading(true);
    host.invoke<{ rows: Row[] }>('diff_rows', { diff, from, count: PAGE }).then(
      (answer) => {
        // An answer for a comparison that is no longer the one shown is dropped.
        if (shown.current !== diff) return;
        setRows((before) => (from === 0 ? answer.rows : [...before, ...answer.rows]));
        setReading(false);
      },
      (error: unknown) => {
        if (shown.current !== diff) return;
        setProblem(problemKey(error));
        setReading(false);
      },
    );
  };

  useEffect(() => {
    shown.current = diff;
    setRows([]);
    setProblem(null);
    if (diff !== null && total > 0) more(0);
  }, [diff, total]);

  const count = (value: number) => new Intl.NumberFormat(language).format(value);
  if (problem !== null) return <p className={styles.note} data-problem="true">{t(problem)}</p>;
  if (diff === null) return <p className={styles.note}>{t('dev.diff.sidesEmpty')}</p>;
  if (total === 0) return <p className={styles.note}>{t('dev.diff.identical')}</p>;

  return (
    <div className={styles.sides} data-wrap={wrap} role="table" aria-label={t('dev.diff.sides')}>
      <div className={styles.rows}>
        {rows.map((row, at) =>
          'skipped' in row ? (
            <div key={at} className={styles.skipped} role="row">
              {t('dev.diff.skipped', { count: count(row.skipped) })}
            </div>
          ) : (
            <div key={at} className={styles.row} role="row">
              <SideCells side={row.left} kind={row.kind === 'added' ? 'none' : row.kind} sign={row.kind === 'same' ? ' ' : '−'} />
              <SideCells side={row.right} kind={row.kind === 'removed' ? 'none' : row.kind === 'changed' ? 'changed-new' : row.kind} sign={row.kind === 'same' ? ' ' : '+'} />
            </div>
          ),
        )}
      </div>
      {rows.length < total && (
        <button type="button" className={styles.more} disabled={reading} onClick={() => more(rows.length)}>
          {t('dev.batch.more', { count: count(total - rows.length) })}
        </button>
      )}
    </div>
  );
}
