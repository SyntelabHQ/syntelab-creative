import { useI18n } from '@syntelab/i18n';
import { fileName, useTabCommands } from '@syntelab/shell-api';
import type { AppViewProps } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { otherTabCommands } from '../commands';
import { openFolderSearchTab, openNewTextTab, openTextInTab } from '../document/open-text';
import { fileProblem, openText } from '../document/text-file';
import { Splitter } from '../panel/splitter';
import styles from './compare-view.module.css';
import { openCompareTab, takeCompareSides } from './open-compare';
import type { CompareSide } from './open-compare';

/** A side of a row, as `compare` gives it. */
interface RowSide {
  readonly number: number;
  readonly pieces: readonly { readonly text: string; readonly changed: boolean }[];
}

interface Row {
  readonly kind: 'same' | 'removed' | 'added' | 'changed';
  readonly left: RowSide | null;
  readonly right: RowSide | null;
}

interface Comparison {
  readonly identical: boolean;
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
  readonly same: number;
  readonly skippedAfter: number;
  readonly hunks: readonly { readonly skipped: number; readonly rows: readonly Row[] }[];
}

/** A text that is being compared: where it is from, and what it says once it is read. */
interface Loaded {
  readonly name: string;
  readonly path: string | null;
  readonly text: string;
}

/** The room the line numbers of each text take, in pixels: what is left is divided between the two texts. */
const NUMBERS = 56;
/** The least of the room either text is left with, as a share. */
const SMALLEST_SHARE = 0.15;
/** How many lines of a text are shown before the two are compared: enough to see it is the right one. */
const SHOWN_BEFORE = 2000;

/** A side that is typed and has nothing in it yet. */
const TYPED_NOTHING: Loaded = { name: '', path: null, text: '' };

const IGNORING = ['ignoreCase', 'ignoreSpaces', 'ignoreEmptyLines', 'ignoreNumbers', 'ignorePunctuation'] as const;

/** How alike two texts are, from 0 to 1: the lines that are the same, out of all the lines the comparison went through. */
function similarity(found: { readonly same: number; readonly changed: number; readonly added: number; readonly removed: number }): number {
  const all = found.same + found.changed + found.added + found.removed;
  return all === 0 ? 1 : found.same / all;
}
type Ignoring = Readonly<Record<(typeof IGNORING)[number], boolean>>;

function Line({ side }: { side: RowSide | null }) {
  if (!side) return <span className={styles.text} />;
  return (
    <span className={styles.text}>
      {side.pieces.map((piece, index) => (piece.changed ? <mark key={index}>{piece.text}</mark> : <span key={index}>{piece.text}</span>))}
    </span>
  );
}

/**
 * Two texts side by side: the lines only one of them has, and, where a line
 * was changed, which of its words. Only what differs is shown, with a few
 * lines around it; what is the same in between is counted.
 */
export function CompareView({ host, compareKey }: AppViewProps & { readonly compareKey: string }) {
  const { t, language } = useI18n();
  const { invoke } = host;
  const [left, setLeft] = useState<Loaded | null>(null);
  const [right, setRight] = useState<Loaded | null>(null);
  const [ignoring, setIgnoring] = useState<Ignoring>({ ignoreCase: false, ignoreSpaces: false, ignoreEmptyLines: false, ignoreNumbers: false, ignorePunctuation: false });
  /** The two texts are shown in one column, what was taken out above what was put in, instead of side by side. */
  const [inline, setInline] = useState(() => host.loadData<unknown>('compareInline') === true);
  const [found, setFound] = useState<Comparison | null>(null);
  const [problem, setProblem] = useState<{ key: string; values?: Readonly<Record<string, string>> } | null>(null);
  const [working, setWorking] = useState(false);
  /** The two texts are typed or pasted here, in a box over each column, instead of being chosen as files. */
  const [typing, setTyping] = useState(false);
  /** The place of the texts that differ which is in view. */
  const [at, setAt] = useState(0);
  const rows = useRef<HTMLDivElement>(null);
  /** How much of the room the first text takes: the bar between the two is dragged. */
  const [share, setShare] = useState(() => {
    const stored = host.loadData<unknown>('compareShare');
    return typeof stored === 'number' && stored >= SMALLEST_SHARE && stored <= 1 - SMALLEST_SHARE ? stored : 0.5;
  });
  const divide = (next: number) => {
    const kept = Math.min(Math.max(next, SMALLEST_SHARE), 1 - SMALLEST_SHARE);
    setShare(kept);
    host.saveData('compareShare', kept);
  };
  /** How much of the height the boxes the texts are typed in take: the bar under them is dragged. */
  const [typedShare, setTypedShare] = useState(() => {
    const stored = host.loadData<unknown>('compareTypedShare');
    return typeof stored === 'number' && stored >= 0.15 && stored <= 0.85 ? stored : 0.35;
  });
  const divideHeight = (next: number) => {
    const kept = Math.min(Math.max(next, 0.15), 0.85);
    setTypedShare(kept);
    host.saveData('compareTypedShare', kept);
  };
  /** The two texts take their room by these, wherever lines of both stand side by side. */
  const columns = { '--left': `${share}fr`, '--right': `${1 - share}fr`, '--left-share': String(share) } as CSSProperties;
  const number = new Intl.NumberFormat(language);

  const load = async (side: CompareSide): Promise<Loaded | null> => {
    if (!side) return null;
    if ('text' in side) return { name: side.name, path: null, text: side.text };
    try {
      return { name: fileName(side.path), path: side.path, text: (await openText({ invoke }, side.path)).text };
    } catch (error) {
      setProblem(fileProblem(error, 'scribe.problem.cannotOpen'));
      return null;
    }
  };

  useEffect(() => {
    const sides = takeCompareSides(compareKey);
    setTyping(sides.typing);
    void load(sides.left).then(setLeft);
    void load(sides.right).then(setRight);
    // What the tab was opened with is taken once.
  }, []);

  useEffect(() => {
    // A side that is being typed counts from its first letter; one that is to be a file, once it is chosen.
    const first = left ?? (typing ? TYPED_NOTHING : null);
    const second = right ?? (typing ? TYPED_NOTHING : null);
    // While they are typed, there is nothing to compare until both have something: a text beside an empty box is not a text with every line taken out.
    if (!first || !second || (typing ? first.text === '' || second.text === '' : first.text === '' && second.text === '')) return setFound(null);
    let cancelled = false;
    // A moment after the last key: not at every letter typed.
    const wait = setTimeout(() => {
      setWorking(true);
      invoke<Comparison>('compare', { left: first.text, right: second.text, ...ignoring })
        .then((answer) => {
          if (cancelled) return;
          setFound(answer);
          setAt(0);
        })
        .catch(() => !cancelled && setProblem({ key: 'scribe.compare.failed' }))
        .finally(() => !cancelled && setWorking(false));
    }, typing ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(wait);
    };
  }, [left, right, typing, ignoring, invoke]);

  const choose = async (set: (loaded: Loaded | null) => void) => {
    const [picked] = await host.pickFiles({ typeName: t('scribe.file.anyType'), extensions: ['*'] });
    if (!picked) return;
    setProblem(null);
    const loaded = await load({ path: picked });
    if (loaded) set(loaded);
  };

  const goTo = (index: number) => {
    const count = found?.hunks.length ?? 0;
    if (count === 0) return;
    const next = (index + count) % count;
    setAt(next);
    rows.current?.querySelector(`[data-hunk="${next}"]`)?.scrollIntoView({ block: 'start' });
  };

  const commands = useMemo(
    () =>
      otherTabCommands({
        onNew: () => openNewTextTab(host, t('scribe.file.untitled')),
        onOpen: async () => {
          for (const picked of await host.pickFiles({ typeName: t('scribe.file.anyType'), extensions: ['*'], multiple: true })) openTextInTab(host, picked);
        },
        onCompareFiles: () => openCompareTab(host, t('scribe.compare.title')),
        onCompareTexts: () => openCompareTab(host, t('scribe.compare.title'), null, null, true),
        onFindInFolder: () => openFolderSearchTab(host, t('scribe.folder.title')),
        onClose: () => host.closeTab(),
        onSettings: host.openSettings,
      }),
    // `host` changes when the tab moves to the back; what it opens does not.
    [host.openTab, host.closeTab, host.openSettings, host.pickFiles, t],
  );
  useTabCommands(host, commands);

  const leftLines = useMemo(() => (left ? left.text.split('\n', SHOWN_BEFORE + 1) : []), [left]);
  const rightLines = useMemo(() => (right ? right.text.split('\n', SHOWN_BEFORE + 1) : []), [right]);

  const side = (loaded: Loaded | null, set: (loaded: Loaded | null) => void, label: string) => (
    <div className={styles.side}>
      <span className={styles.sideLabel}>{label}</span>
      <bdi className={styles.sideName} title={loaded?.path ?? undefined}>
        {loaded ? loaded.name : t('scribe.compare.notChosen')}
      </bdi>
      <Button variant={loaded ? undefined : 'primary'} onClick={() => void choose(set)}>
        <Icon name="folder-open" size={14} />
        {t('scribe.compare.chooseFile')}
      </Button>
      {loaded?.path && (
        <Button variant="ghost" onClick={() => loaded.path && openTextInTab(host, loaded.path)}>
          {t('scribe.compare.openInEditor')}
        </Button>
      )}
    </div>
  );

  return (
    <div className={styles.view} style={columns}>
      <header className={styles.top}>
        <div className={styles.sides}>
          {side(left, setLeft, t('scribe.compare.first'))}
          {side(right, setRight, t('scribe.compare.second'))}
        </div>
        <div className={styles.bar}>
          {IGNORING.map((name) => (
            <label key={name} className={styles.flag}>
              <input type="checkbox" checked={ignoring[name]} onChange={(event) => setIgnoring((current) => ({ ...current, [name]: event.target.checked }))} />
              {t(`scribe.compare.${name}`)}
            </label>
          ))}
          <label className={styles.flag}>
            <input type="checkbox" checked={typing} onChange={(event) => setTyping(event.target.checked)} />
            {t('scribe.compare.typing')}
          </label>
          <label className={styles.flag}>
            <input
              type="checkbox"
              checked={inline}
              onChange={(event) => {
                setInline(event.target.checked);
                host.saveData('compareInline', event.target.checked);
              }}
            />
            {t('scribe.compare.inline')}
          </label>
          <span className={styles.spring} />
          {found && !found.identical && (
            <>
              <span className={styles.summary} role="status">
                <span data-kind="alike">{t('scribe.compare.alike', { percent: new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 }).format(similarity(found)) })}</span>
                <span data-kind="changed">{t('scribe.compare.changed', { count: found.changed })}</span>
                <span data-kind="added">{t('scribe.compare.added', { count: found.added })}</span>
                <span data-kind="removed">{t('scribe.compare.removed', { count: found.removed })}</span>
              </span>
              <span className={styles.place}>{t('scribe.compare.place', { at: at + 1, count: found.hunks.length })}</span>
              <Button onClick={() => goTo(at - 1)} aria-label={t('scribe.compare.previous')}>
                <Icon name="chevron-up" size={14} />
              </Button>
              <Button onClick={() => goTo(at + 1)} aria-label={t('scribe.compare.next')}>
                <Icon name="chevron-down" size={14} />
              </Button>
            </>
          )}
        </div>
      </header>

      {problem && (
        <p className={styles.problem} role="alert">
          {t(problem.key, problem.values)}
        </p>
      )}
      <div className={styles.area} data-inline={inline} style={{ '--typed-share': String(typedShare) } as CSSProperties}>
        {/* One bar between the two texts, from the boxes they are typed in down to the last line compared; in one column, only between the boxes. */}
        {(typing || ((left || right) && !inline)) && (
          <Splitter
            orientation="vertical"
            label={t('scribe.pane.drag')}
            onMove={(_share, pixels, size) => size > 2 * NUMBERS && divide((pixels - NUMBERS) / (size - 2 * NUMBERS))}
            onStep={(by) => divide(share + by * 0.05)}
            onReset={() => divide(0.5)}
          />
        )}
      {typing && (
        <div className={styles.typed} style={{ flex: `0 0 ${typedShare * 100}%` }}>
          {([
            [left, setLeft, 'scribe.compare.first'],
            [right, setRight, 'scribe.compare.second'],
          ] as const).map(([loaded, set, label]) => (
            <textarea
              key={label}
              className={styles.typedText}
              dir="auto"
              spellCheck={false}
              value={loaded?.text ?? ''}
              placeholder={t('scribe.compare.typeHere')}
              aria-label={t(label)}
              onChange={(event) => {
                setProblem(null);
                // A text that is typed over is no longer the file it came from.
                set({ name: t('scribe.compare.typedName'), path: null, text: event.target.value });
              }}
            />
          ))}
        </div>
      )}
      {typing && <Splitter orientation="horizontal" label={t('scribe.compare.dragHeight')} onMove={(dragged) => divideHeight(dragged)} onStep={(by) => divideHeight(typedShare + by * 0.05)} onReset={() => divideHeight(0.35)} />}
      {found?.identical && (
        <p className={styles.note} role="status">
          <Icon name="circle-check" size={16} />
          {t('scribe.compare.identical', { count: found.same })}
        </p>
      )}
      {working && !found && <p className={styles.note}>{t('scribe.compare.working')}</p>}
      {typing && !problem && (left?.text ?? '') === '' !== ((right?.text ?? '') === '') && <p className={styles.note}>{t('scribe.compare.typeOther')}</p>}
      {(!left || !right) && !problem && !typing && <p className={styles.note}>{t(left || right ? 'scribe.compare.chooseOther' : 'scribe.compare.chooseBoth')}</p>}

      <div className={styles.body}>
        {/* Before the two are compared (one is not chosen yet, or they are the same), the texts themselves: what was chosen is seen at once. */}
        {(left || right) && !typing && (!found || found.identical) && (
          <div className={styles.rows}>
            {Array.from({ length: Math.min(Math.max(leftLines.length, rightLines.length), SHOWN_BEFORE) }, (_, line) => (
              <div key={line} className={styles.row} data-kind="same">
                <span className={styles.number}>{line < leftLines.length ? number.format(line + 1) : ''}</span>
                <span className={styles.text}>{leftLines[line] ?? ''}</span>
                <span className={styles.number}>{line < rightLines.length ? number.format(line + 1) : ''}</span>
                <span className={styles.text}>{rightLines[line] ?? ''}</span>
              </div>
            ))}
            {Math.max(leftLines.length, rightLines.length) > SHOWN_BEFORE && <p className={styles.skipped}>{t('scribe.compare.skipped', { count: Math.max(leftLines.length, rightLines.length) - SHOWN_BEFORE })}</p>}
          </div>
        )}
        {found && !found.identical && (
          <div ref={rows} className={styles.rows}>
          {found.hunks.map((hunk, index) => (
            <section key={index} data-hunk={index} className={styles.hunk}>
              {hunk.skipped > 0 && <p className={styles.skipped}>{t('scribe.compare.skipped', { count: hunk.skipped })}</p>}
              {inline &&
                hunk.rows.flatMap((row, line) => {
                  // In one column a changed line is two: what it was, then what it is.
                  const sides: { readonly side: RowSide; readonly kind: string; readonly sign: string }[] = [];
                  if (row.left && row.kind !== 'added') sides.push({ side: row.left, kind: row.kind === 'same' ? 'same' : 'removed', sign: row.kind === 'same' ? '' : '−' });
                  if (row.right && row.kind !== 'same' && row.kind !== 'removed') sides.push({ side: row.right, kind: 'added', sign: '+' });
                  return sides.map((shown) => (
                    <div key={`${line}-${shown.kind}`} className={styles.inlineRow} data-kind={shown.kind}>
                      <span className={styles.number}>{number.format(shown.side.number)}</span>
                      <span className={styles.sign}>{shown.sign}</span>
                      <Line side={shown.side} />
                    </div>
                  ));
                })}
              {!inline && hunk.rows.map((row, line) => (
                <div key={line} className={styles.row} data-kind={row.kind}>
                  <span className={styles.number}>{row.left ? number.format(row.left.number) : ''}</span>
                  <Line side={row.left} />
                  <span className={styles.number}>{row.right ? number.format(row.right.number) : ''}</span>
                  <Line side={row.right} />
                </div>
              ))}
            </section>
          ))}
          {found.skippedAfter > 0 && <p className={styles.skipped}>{t('scribe.compare.skipped', { count: found.skippedAfter })}</p>}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
