import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { problemKey } from '../../api/dev-api';
import { formatBytes, formatDuration } from '../../frame/format';
import { TextBox, Toggle } from '../../frame/toggle';
import frame from '../../frame/tool-frame.module.css';
import { ToolProgress } from '../../frame/tool-progress';
import styles from './folder-diff.module.css';

/** How a file of the two folders stands. */
const STATES = ['different', 'only-left', 'only-right', 'same', 'unread'] as const;
type State = (typeof STATES)[number];

interface Facts {
  readonly size: number;
  /** In seconds since 1970; 0 when it is not known. */
  readonly modified: number;
}

interface Row {
  readonly path: string;
  readonly state: State;
  readonly left: Facts | null;
  readonly right: Facts | null;
  readonly leftFile: string | null;
  readonly rightFile: string | null;
}

/** What the `folders_compare` command of the Rust side answers. */
interface Compared {
  readonly folders: number;
  readonly files: number;
  readonly onlyLeft: number;
  readonly onlyRight: number;
  readonly same: number;
  readonly different: number;
  readonly unread: number;
  readonly ms: number;
}

export interface FolderDiffProps {
  readonly host: Pick<AppHost, 'invoke' | 'pickFolder'>;
  /** What stands first in the line of options (the choice of what is compared). */
  readonly lead: ReactNode;
  /** Folders the tool was opened with from outside the program: compared at once when there are two. */
  readonly start?: { readonly left: string; readonly right: string };
  /** Two files of a row are to be compared as texts. */
  readonly onPair: (left: string, right: string) => void;
}

/** Rows are asked for, and drawn, so many at a time. */
const PAGE = 500;
const ICONS: Readonly<Record<State, string>> = { different: 'code-compare', 'only-left': 'arrow-left', 'only-right': 'arrow-right', same: 'circle-check', unread: 'triangle-exclamation' };

/**
 * Two folders compared file by file: which files only one of them has,
 * which both have and are the same, which differ. The Rust side reads the
 * pairs of the same size side by side and holds what it found; the list is
 * asked for a part at a time, so neither how many files nor how large has a
 * most. A pair is opened in the comparison of texts with a click.
 */
export function FolderDiff({ host, lead, start, onPair }: FolderDiffProps) {
  const { t, language } = useI18n();
  // Not kept between uses: where the folders are is the user's to say each time.
  const [left, setLeft] = useState(start?.left ?? '');
  const [right, setRight] = useState(start?.right ?? '');
  const [deep, setDeep] = useState(true);
  const [endings, setEndings] = useState('');
  const [compared, setCompared] = useState<Compared | null>(null);
  /** The states shown; none for all of them. */
  const [only, setOnly] = useState<State | null>(null);
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [matching, setMatching] = useState(0);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const held = useRef<number | null>(null);

  const close = () => {
    if (held.current !== null) void host.invoke('folders_close', { folders: held.current }).catch(() => {});
    held.current = null;
  };
  // What the Rust side holds is let go when the tool goes away.
  useEffect(() => close, []);

  const more = (folders: number, from: number, state: State | null) =>
    host.invoke<{ rows: Row[]; count: number }>('folders_rows', { folders, from, count: PAGE, states: state === null ? [] : [state] }).then(
      (answer) => {
        if (held.current !== folders) return;
        setRows((before) => (from === 0 ? answer.rows : [...before, ...answer.rows]));
        setMatching(answer.count);
      },
      (error: unknown) => setProblem(problemKey(error)),
    );

  const run = async () => {
    setProblem(null);
    setWorking(true);
    close();
    setCompared(null);
    setRows([]);
    try {
      const answer = await host.invoke<Compared>('folders_compare', { left: left.trim(), right: right.trim(), deep, endings: endings.split(/[\s,;]+/).map((ending) => ending.replace(/^\*?\./, '').toLowerCase()).filter(Boolean) });
      held.current = answer.folders;
      setCompared(answer);
      // What differs is what is looked for: it is shown first when there is any.
      const first: State | null = answer.different > 0 ? 'different' : null;
      setOnly(first);
      await more(answer.folders, 0, first);
    } catch (error) {
      setProblem(problemKey(error));
    } finally {
      setWorking(false);
    }
  };

  // Two folders given from outside are compared without being asked for twice.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !start || start.left === '' || start.right === '') return;
    started.current = true;
    void run();
  }, []);

  const show = (state: State | null) => {
    setOnly(state);
    if (compared) void more(compared.folders, 0, state);
  };

  const choose = async (set: (path: string) => void) => {
    const picked = await host.pickFolder();
    if (picked !== null) set(picked);
  };

  const count = (value: number) => new Intl.NumberFormat(language).format(value);
  const facts = (side: Facts | null) => (side === null ? '' : `${formatBytes(side.size, language)}${side.modified > 0 ? ` · ${new Date(side.modified * 1000).toLocaleString(language)}` : ''}`);
  const counts: Readonly<Record<State, number>> = compared ? { different: compared.different, 'only-left': compared.onlyLeft, 'only-right': compared.onlyRight, same: compared.same, unread: compared.unread } : { different: 0, 'only-left': 0, 'only-right': 0, same: 0, unread: 0 };
  const ready = left.trim() !== '' && right.trim() !== '' && !working;
  const differs = compared !== null && compared.files !== compared.same;

  return (
    <>
      <div className={frame.options}>
        {lead}
        <Toggle label={t('dev.folders.deep')} checked={deep} onChange={setDeep} />
        <TextBox label={t('dev.folders.endings')} value={endings} hint={t('dev.folders.endingsHint')} code onChange={setEndings} />
        <span className={frame.spring} />
        <button type="button" className={frame.run} disabled={!ready} onClick={() => void run()}>
          <Icon name="bolt" size={13} />
          {t('dev.folders.run')}
        </button>
      </div>
      <div className={styles.sides}>
        {(
          [
            ['dev.folders.left', left, setLeft],
            ['dev.folders.right', right, setRight],
          ] as const
        ).map(([label, value, set]) => (
          <div key={label} className={styles.side}>
            <TextBox label={t(label)} value={value} hint={t('dev.folders.pathHint')} wide code onChange={set} />
            <button type="button" className={frame.action} onClick={() => void choose(set)}>
              <Icon name="folder-open" size={13} />
              {t('dev.batch.chooseFolder')}
            </button>
          </div>
        ))}
      </div>
      <section className={styles.results} aria-label={t('dev.folders.results')}>
        {problem !== null && (
          <div className={frame.wrong} role="alert">
            <Icon name="triangle-exclamation" size={15} />
            <span className={frame.wrongTexts}>
              <span className={frame.wrongMessage}>{t(problem)}</span>
            </span>
          </div>
        )}
        {compared && (
          <div className={frame.fine} role="status">
            <Icon name="circle-check" size={15} />
            <span className={frame.wrongTexts}>
              <span className={frame.wrongMessage}>{t(differs ? 'dev.folders.differ' : 'dev.folders.identical')}</span>
              <span>{t('dev.folders.summary', { files: count(compared.files), time: formatDuration(compared.ms, language) })}</span>
            </span>
          </div>
        )}
        {compared && (
          <div role="radiogroup" aria-label={t('dev.folders.shown')} className={styles.filters}>
            <button type="button" role="radio" aria-checked={only === null} onClick={() => show(null)}>
              {t('dev.folders.state.all', { count: count(compared.files) })}
            </button>
            {STATES.filter((state) => counts[state] > 0 || state !== 'unread').map((state) => (
              <button key={state} type="button" role="radio" aria-checked={only === state} data-state={state} onClick={() => show(state)}>
                {t(`dev.folders.state.${state}`, { count: count(counts[state]) })}
              </button>
            ))}
          </div>
        )}
        {compared === null ? (
          <div className={frame.blank}>{t('dev.folders.empty')}</div>
        ) : rows.length === 0 ? (
          <div className={frame.blank}>{t('dev.folders.none')}</div>
        ) : (
          <ul className={styles.list}>
            {rows.map((row) => {
              const pair = row.leftFile !== null && row.rightFile !== null ? ([row.leftFile, row.rightFile] as const) : null;
              return (
                <li key={row.path} className={styles.file} data-state={row.state}>
                  <span className={styles.state} aria-hidden="true">
                    <Icon name={ICONS[row.state]} size={13} />
                  </span>
                  <span className={styles.texts}>
                    <bdi className={styles.name}>{row.path}</bdi>
                    <span className={styles.facts}>{t(`dev.folders.said.${row.state}`)}</span>
                  </span>
                  <span className={styles.fact}>{facts(row.left)}</span>
                  <span className={styles.fact}>{facts(row.right)}</span>
                  <button type="button" className={frame.action} disabled={pair === null} onClick={() => pair && onPair(pair[0], pair[1])}>
                    {t('dev.folders.compare')}
                  </button>
                </li>
              );
            })}
            {rows.length < matching && (
              <li className={styles.more}>
                <button type="button" className={frame.action} onClick={() => compared && void more(compared.folders, rows.length, only)}>
                  {t('dev.batch.more', { count: count(matching - rows.length) })}
                </button>
              </li>
            )}
          </ul>
        )}
        {working && <ToolProgress host={host} title={t('dev.folders.working')} />}
      </section>
    </>
  );
}
