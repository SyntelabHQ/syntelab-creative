import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { problemKey } from '../api/dev-api';
import styles from './json-tree.module.css';
import { flatten, wayKey } from './json-tree-rows';
import type { Loaded, TreeRow } from './json-tree-rows';
import type { ToolInput } from './text-tool';

export interface JsonTreeProps {
  readonly host: Pick<AppHost, 'invoke'>;
  /** The document to show: a text, or a file read from where it is. Null while there is none. */
  readonly source: ToolInput | null;
  /** Comments and a comma after the last item are let by when the document is read. */
  readonly lenient: boolean;
}

/** How many members or items are asked for at once. An object or an array has no most: the rest is asked for as it is wanted. */
const PAGE = 200;
/** How tall a row is, in pixels: the list draws only the rows that are in view. */
const ROW_HEIGHT = 24;
/** Rows drawn beyond what is in view, on each side. */
const BEYOND = 20;
/** The most places a search lists; how many there are in all is told beside them. */
const MOST_HITS = 200;

interface Hit {
  readonly way: readonly number[];
  readonly row: TreeRow;
}

/**
 * A JSON document as a tree that folds: each object and array a row that
 * opens onto its members. The document is held by the Rust side; only the
 * rows that are opened are asked for, a page at a time, and only those in
 * view are drawn, so a document of any size is shown the same way. A text
 * can be sought in keys and values: each place found opens the way to it.
 */
export function JsonTree({ host, source, lenient }: JsonTreeProps) {
  const { t, language } = useI18n();
  /** The number the Rust side holds the tree under; null while there is none. */
  const [tree, setTree] = useState<number | null>(null);
  const [root, setRoot] = useState<TreeRow | null>(null);
  const [loaded, setLoaded] = useState<ReadonlyMap<string, Loaded>>(new Map());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [sought, setSought] = useState('');
  const [hits, setHits] = useState<{ readonly list: readonly Hit[]; readonly count: number } | null>(null);
  /** The row a search led to: marked, and brought into view. */
  const [marked, setMarked] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(0);
  const [height, setHeight] = useState(400);
  const list = useRef<HTMLDivElement>(null);
  const held = useRef<number | null>(null);

  // The tree is asked for anew whenever the document changes, and the one before it is let go.
  useEffect(() => {
    let current = true;
    const close = () => {
      if (held.current !== null) void host.invoke('tree_close', { tree: held.current }).catch(() => {});
      held.current = null;
    };
    setTree(null);
    setRoot(null);
    setLoaded(new Map());
    setOpen(new Set());
    setHits(null);
    setMarked(null);
    setProblem(null);
    if (source === null) {
      close();
      return;
    }
    void host
      .invoke<{ ok: boolean; tree?: number; root?: TreeRow }>('tree_open', { ...('text' in source ? { text: source.text } : { path: source.path }), lenient })
      .then(async (answer) => {
        if (!current || !answer.ok || answer.tree === undefined || !answer.root) {
          if (answer.tree !== undefined) void host.invoke('tree_close', { tree: answer.tree }).catch(() => {});
          return;
        }
        close();
        held.current = answer.tree;
        setTree(answer.tree);
        setRoot(answer.root);
        // The first level is open from the start: a tree shown shut says nothing.
        const first = await host.invoke<{ rows: TreeRow[] }>('tree_rows', { tree: answer.tree, way: [], from: 0, count: PAGE });
        if (!current) return;
        setLoaded(new Map([[wayKey([]), { rows: first.rows }]]));
        setOpen(new Set([wayKey([])]));
      })
      .catch((error: unknown) => current && setProblem(problemKey(error)));
    return () => {
      current = false;
    };
  }, [host.invoke, source, lenient]);
  useEffect(
    () => () => {
      if (held.current !== null) void host.invoke('tree_close', { tree: held.current }).catch(() => {});
    },
    [host.invoke],
  );

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const watch = new ResizeObserver(() => setHeight(element.clientHeight));
    watch.observe(element);
    return () => watch.disconnect();
  }, []);

  /** Asks for more of the members of a value, so that at least `upTo` of them are there. */
  const load = async (way: readonly number[], upTo: number, known: ReadonlyMap<string, Loaded>): Promise<ReadonlyMap<string, Loaded>> => {
    if (tree === null) return known;
    const key = wayKey(way);
    const have = known.get(key)?.rows ?? [];
    if (have.length >= upTo) return known;
    const more = await host.invoke<{ rows: TreeRow[] }>('tree_rows', { tree, way, from: have.length, count: Math.max(PAGE, upTo - have.length) });
    return new Map(known).set(key, { rows: [...have, ...more.rows] });
  };

  const toggle = async (way: readonly number[]) => {
    const key = wayKey(way);
    const next = new Set(open);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      setLoaded(await load(way, 1, loaded));
    }
    setOpen(next);
  };

  /** Opens every value on the way to a place, and brings the place into view. */
  const reveal = async (way: readonly number[]) => {
    let known = loaded;
    const next = new Set(open);
    for (let depth = 0; depth < way.length; depth++) {
      const parent = way.slice(0, depth);
      known = await load(parent, (way[depth] ?? 0) + 1, known);
      next.add(wayKey(parent));
    }
    setLoaded(known);
    setOpen(next);
    setMarked(wayKey(way));
  };

  const seek = async () => {
    if (tree === null || sought.trim() === '') return setHits(null);
    try {
      const found = await host.invoke<{ hits: Hit[]; count: number }>('tree_find', { tree, sought: sought.trim(), most: MOST_HITS });
      setHits({ list: found.hits, count: found.count });
    } catch (error) {
      setProblem(problemKey(error));
    }
  };

  const rows = useMemo(() => (root ? flatten(root, loaded, open) : []), [root, loaded, open]);

  // The row a search led to is brought into view once it is among the rows.
  useEffect(() => {
    if (marked === null) return;
    const at = rows.findIndex((row) => row.kind === 'value' && wayKey(row.way) === marked);
    if (at >= 0) list.current?.scrollTo({ top: Math.max(0, at * ROW_HEIGHT - height / 2) });
  }, [marked, rows.length]);

  const count = (value: number) => new Intl.NumberFormat(language).format(value);
  const first = Math.max(0, Math.floor(scrolled / ROW_HEIGHT) - BEYOND);
  const last = Math.min(rows.length, Math.ceil((scrolled + height) / ROW_HEIGHT) + BEYOND);

  return (
    <div className={styles.tree}>
      <form
        className={styles.seek}
        onSubmit={(event) => {
          event.preventDefault();
          void seek();
        }}
      >
        <Icon name="magnifying-glass" size={13} />
        <input type="search" value={sought} placeholder={t('dev.tree.seek')} aria-label={t('dev.tree.seek')} spellCheck={false} disabled={tree === null} onChange={(event) => setSought(event.target.value)} />
        {hits && <span className={styles.found}>{hits.count > hits.list.length ? t('dev.tree.foundFirst', { shown: count(hits.list.length), count: count(hits.count) }) : t('dev.tree.found', { count: count(hits.count) })}</span>}
      </form>
      {hits && hits.list.length > 0 && (
        <ul className={styles.hits}>
          {hits.list.map((hit) => (
            <li key={wayKey(hit.way)}>
              <button type="button" className={styles.hit} aria-current={marked === wayKey(hit.way)} onClick={() => void reveal(hit.way)}>
                {hit.row.key !== null && <bdi className={styles.key}>{hit.row.key}</bdi>}
                <bdi className={styles.value} data-kind={hit.row.kind}>
                  {hit.row.text || (hit.row.kind === 'array' ? `[ ${count(hit.row.children)} ]` : `{ ${count(hit.row.children)} }`)}
                </bdi>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={list} className={styles.list} role="tree" onScroll={(event) => setScrolled(event.currentTarget.scrollTop)}>
        {problem && <p className={styles.note}>{t(problem)}</p>}
        {!problem && rows.length === 0 && <p className={styles.note}>{t(source === null ? 'dev.tree.empty' : 'dev.tree.reading')}</p>}
        <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
          {rows.slice(first, last).map((row, index) => {
            const top = (first + index) * ROW_HEIGHT;
            const indent = { paddingInlineStart: 12 + row.way.length * 16 };
            if (row.kind === 'more') {
              return (
                <button key={`more:${wayKey(row.way)}`} type="button" className={styles.more} style={{ top, ...indent }} onClick={() => void load(row.way.slice(0, -1), row.shown + PAGE, loaded).then(setLoaded)}>
                  {t('dev.tree.more', { count: count(row.left) })}
                </button>
              );
            }
            const key = wayKey(row.way);
            const holds = row.row.kind === 'object' || row.row.kind === 'array';
            return (
              <div key={key} role="treeitem" aria-expanded={holds ? open.has(key) : undefined} aria-selected={marked === key} className={styles.row} data-marked={marked === key} style={{ top, ...indent }} onClick={holds ? () => void toggle(row.way) : undefined}>
                <span className={styles.fold}>{holds && row.row.children > 0 && <Icon name={open.has(key) ? 'chevron-down' : 'chevron-right'} size={10} />}</span>
                {row.label !== null && <bdi className={styles.key}>{row.label}</bdi>}
                <bdi className={styles.value} data-kind={row.row.kind}>
                  {holds ? (row.row.kind === 'array' ? `[ ${count(row.row.children)} ]` : `{ ${count(row.row.children)} }`) : row.row.text}
                </bdi>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
