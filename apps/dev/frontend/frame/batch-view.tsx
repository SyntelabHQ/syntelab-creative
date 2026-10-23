import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { findFiles, problemKey, stopWork } from '../api/dev-api';
import { addFiles, shownAsText, splitPath, TARGET_KINDS, totalsOf } from './batch';
import type { BatchItem, BatchTarget, FoundFile, Naming, TargetKind } from './batch';
import styles from './batch-view.module.css';
import { FilePreview } from './file-preview';
import type { FilePreviewProps } from './file-preview';
import { formatBytes, formatDuration } from './format';
import type { ToolLayout } from './layout';
import { SplitPanes } from './split-panes';
import type { ToolActions } from './text-tool';
import frame from './tool-frame.module.css';
import { ToolProgress } from './tool-progress';

export interface BatchViewProps {
  readonly host: AppHost;
  readonly layout: ToolLayout;
  /** Shown and at work; false while the tool works on a text instead. */
  readonly active: boolean;
  /** What stands first in the line of options (the choice between a text and many files). */
  readonly lead?: ReactNode;
  /** The options of the tool, the same as for a text. */
  readonly options: ReactNode;
  /** Changes whenever the options do: what the last run came to is then no longer shown, being of other options. */
  readonly optionsKey: string;
  /** As the options are now, the tool only tells something of each file: nothing is written. */
  readonly tellsOnly: boolean;
  /** The kind of files offered when files are added, and the endings looked for in a folder. */
  readonly opens: { readonly typeName: string; readonly extensions: readonly string[] };
  /** How the results are named after their files. */
  readonly naming: Naming;
  /** The result of a file is short whatever the file is (digests): it can be shown beside the file, with nothing written; that is what is done unless the user chooses otherwise. */
  readonly shows?: boolean;
  /** Files the tool was opened with from outside the program: listed when the tool is made, and run at once when nothing is written by that. */
  readonly add?: readonly string[];
  /** On files the tool only tells something of each (whether it fits a schema): nothing is ever written. */
  readonly onlyReads?: boolean;
  /** Runs the tool on every file. `target` is null when nothing is written. Rejects with what `host.invoke` rejects with. */
  readonly run: (files: readonly FoundFile[], target: BatchTarget | null, overwrite: boolean) => Promise<readonly BatchItem[]>;
  /** Only reads the files and says of each whether the tool takes it: files are told so the moment they are added. */
  readonly check?: (files: readonly FoundFile[]) => Promise<readonly BatchItem[]>;
  /** What is wrong with a file the tool does not take, by the code the Rust side gave, already translated. */
  readonly wrongText: (code: string) => string;
  /** What the card over the tool is titled with while the work lasts, already translated. */
  readonly workTitle: string;
  /** Gives the program what its commands do with this tool; null when the tool goes away. */
  readonly onActions: (actions: ToolActions | null) => void;
  /** How the result of one file is shown when it is chosen in the list: the file is run alone, and nothing is written where the results go. */
  readonly preview?: Pick<FilePreviewProps, 'run' | 'writesNothing' | 'syntax'>;
}

/** Something said in the line under the tool: a key of the translations, with what it needs. */
interface Told {
  readonly key: string;
  readonly values?: Readonly<Record<string, string>>;
  readonly problem?: boolean;
}

/** How many files the list draws at first, and how many more each time more are asked for. The list itself has no most. */
const DRAWN_AT_ONCE = 500;

const STATUS_ICONS: Readonly<Record<BatchItem['status'], string>> = { done: 'circle-check', wrong: 'triangle-exclamation', skipped: 'ban', failed: 'triangle-exclamation' };

/**
 * The frame of a tool at work on many files in one run: the files on one
 * side (added one by one or by the folder), where the results go on the
 * other, and after the run how each file came out. The files are worked on
 * by the Rust side, one after another, each read from disk as it comes; one
 * that is wrong does not stop the others. Neither how many files nor how
 * large has a most. A file chosen in the list is run alone, and its result
 * shown under where the results go, before anything is written.
 *
 * The list is kept in memory only: Burn empties it, and nothing of it is
 * written anywhere.
 */
export function BatchView({ host, layout, active, lead, options, optionsKey, tellsOnly, opens, naming, shows, add: given, run, check, wrongText, workTitle, onActions, preview }: BatchViewProps) {
  const { t, language } = useI18n();
  const [files, setFiles] = useState<readonly FoundFile[]>([]);
  /** A folder that is added gives the files under its folders too. */
  const [deep, setDeep] = useState(true);
  const [kind, setKind] = useState<TargetKind>(shows ? 'shown' : 'beside');
  /** Files given from outside wait to be run, once they are listed. */
  const [runsWhenListed, setRunsWhenListed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  /** How each file came out in the last run, by its path. */
  const [results, setResults] = useState<ReadonlyMap<string, BatchItem> | null>(null);
  /** What the check of each file came to when it was added, by its path. */
  const [checks, setChecks] = useState<ReadonlyMap<string, BatchItem>>(new Map());
  const [took, setTook] = useState(0);
  const [drawn, setDrawn] = useState(DRAWN_AT_ONCE);
  const [working, setWorking] = useState(false);
  /** Run was pressed with "over the files themselves": the user is asked once more. */
  const [asking, setAsking] = useState(false);
  const [told, setTold] = useState<Told | null>(null);
  /** The file whose result is previewed, chosen in the list. */
  const [chosen, setChosen] = useState<FoundFile | null>(null);

  const count = (value: number) => new Intl.NumberFormat(language).format(value);
  /** The endings looked for in a folder; none when the tool takes files of any kind. */
  const endings = opens.extensions.includes('*') ? [] : opens.extensions;
  const size = files.reduce((sum, file) => sum + file.size, 0);

  const add = async (paths: readonly string[]) => {
    if (paths.length === 0) return;
    try {
      const found = await findFiles(host, paths, deep, endings);
      setFiles((known) => addFiles(known, found));
      setResults(null);
      setTold(found.length === 0 ? { key: 'dev.batch.noneFound' } : null);
      // Before anything else is done with them, the files are read once and each is told whether the tool takes it.
      const fresh = found.filter((file) => !checks.has(file.path));
      if (check && fresh.length > 0) {
        setWorking(true);
        try {
          const items = await check(fresh);
          setChecks((known) => new Map([...known, ...items.map((item): [string, BatchItem] => [item.path, item])]));
        } finally {
          setWorking(false);
        }
      }
    } catch (error) {
      setTold({ key: problemKey(error), problem: true });
    }
  };

  const addSomeFiles = async () => add(await host.pickFiles({ typeName: opens.typeName, extensions: opens.extensions, multiple: true }));
  const addFolder = async () => {
    const picked = await host.pickFolder();
    if (picked !== null) await add([picked]);
  };

  const clear = () => {
    setFiles([]);
    setChosen(null);
    setResults(null);
    setChecks(new Map());
    setDrawn(DRAWN_AT_ONCE);
    setAsking(false);
    setTold(null);
  };

  const chooseFolder = async () => {
    const picked = await host.pickFolder();
    if (picked === null) return;
    setFolder(picked);
    setKind('folder');
  };

  const target: BatchTarget | null = tellsOnly ? null : kind === 'shown' ? (shows ? { kind } : null) : kind === 'beside' ? { kind, ...naming.beside } : kind === 'replace' ? (naming.noReplace ? null : { kind }) : folder !== null ? { kind, folder, ...naming.inFolder } : null;
  const ready = files.length > 0 && !working && (tellsOnly || target !== null);

  const runNow = async (confirmed = false) => {
    if (!ready) return;
    if (target?.kind === 'replace' && !confirmed) {
      setAsking(true);
      return;
    }
    setAsking(false);
    setTold(null);
    setWorking(true);
    const started = performance.now();
    try {
      const items = await run(files, target, overwrite);
      setResults(new Map(items.map((item) => [item.path, item])));
      setTook(performance.now() - started);
    } catch (error) {
      setTold({ key: problemKey(error), problem: true });
    } finally {
      setWorking(false);
    }
  };

  const burn = () => {
    if (working) void stopWork(host).catch(() => {});
    clear();
    setFolder(null);
    setTold({ key: 'dev.frame.burnt' });
  };

  /** Every result that is shown, as one text on the clipboard. */
  const copyShown = () => {
    if (!results) return;
    void navigator.clipboard.writeText(shownAsText(files.flatMap((file) => results.get(file.path) ?? []))).then(
      () => setCopied(true),
      () => setTold({ key: 'dev.problem.clipboard', problem: true }),
    );
  };

  // The commands of the program reach what these do now, not what they did when they were made.
  const latest = useRef({ runNow, addSomeFiles, burn, copyShown });
  latest.current = { runNow, addSomeFiles, burn, copyShown };

  // The files the tool was opened with are listed once; they are run at once only when that writes nothing.
  const taken = useRef(false);
  useEffect(() => {
    if (!given || taken.current) return;
    taken.current = true;
    void add(given).then(() => setRunsWhenListed(true));
  }, [given]);
  useEffect(() => {
    if (!runsWhenListed || working) return;
    setRunsWhenListed(false);
    if (files.length > 0 && (tellsOnly || target?.kind === 'shown')) void runNow();
  }, [runsWhenListed, working, files.length]);
  useEffect(() => {
    if (!active) return;
    onActions({
      run: () => void latest.current.runNow(),
      open: () => void latest.current.addSomeFiles(),
      // A run over files writes its results itself; what it only shows can be copied.
      save: () => {},
      copy: () => latest.current.copyShown(),
      burn: () => latest.current.burn(),
    });
    return () => onActions(null);
  }, [onActions, active]);

  useEffect(() => {
    setResults(null);
    setAsking(false);
  }, [optionsKey]);
  useEffect(() => setCopied(false), [results]);

  const totals = results ? totalsOf([...results.values()]) : null;
  /** Before a run: how the files that are listed came out of their check. */
  const checkedNow = results === null ? files.flatMap((file) => checks.get(file.path) ?? []) : [];
  const checkTotals = checkedNow.length > 0 ? totalsOf(checkedNow) : null;

  /** What is said of a file after a run: what was read and written, or why it was not done. */
  const said = (item: BatchItem): string => {
    if (item.status === 'done') return item.out === null || item.out === undefined ? formatBytes(item.bytesIn, language) : `${formatBytes(item.bytesIn, language)} → ${formatBytes(item.bytesOut, language)}`;
    // A problem that has no place in a text (bytes that are not what the tool takes) is told without one.
    if (item.status === 'wrong') return (item.line ?? 0) > 0 ? `${wrongText(item.code ?? '')} ${t('dev.frame.place', { line: count(item.line ?? 1), column: count(item.column ?? 1) })}` : wrongText(item.code ?? '');
    if (item.status === 'skipped') return t(`dev.batch.skipped.${item.code ?? 'stopped'}`);
    return t(`dev.problem.${item.code ?? 'failed'}`);
  };

  return (
    <>
      <div className={frame.options}>
        {lead}
        {options}
        <span className={frame.spring} />
        <button type="button" className={frame.run} disabled={!ready} data-tooltip={t('dev.hint.run')} onClick={() => void runNow()}>
          <Icon name="bolt" size={13} />
          {t('dev.batch.run', { count: count(files.length) })}
        </button>
      </div>

      <SplitPanes
        layout={layout}
        first={
          <section className={frame.pane} aria-label={t('dev.batch.files')}>
            <div className={frame.paneHead}>
              <span className={frame.paneTitle}>{t('dev.batch.files')}</span>
              {files.length > 0 && <span className={frame.paneFacts}>{t('dev.batch.count', { count: count(files.length), size: formatBytes(size, language) })}</span>}
              <span className={frame.spring} />
              <button type="button" className={frame.action} onClick={() => void addSomeFiles()}>
                <Icon name="file-circle-plus" size={13} />
                {t('dev.batch.addFiles')}
              </button>
              <button type="button" className={frame.action} onClick={() => void addFolder()}>
                <Icon name="folder-plus" size={13} />
                {t('dev.batch.addFolder')}
              </button>
              <button type="button" className={frame.action} disabled={files.length === 0} onClick={clear}>
                <Icon name="eraser" size={13} />
                {t('dev.frame.clear')}
              </button>
            </div>
            <label className={styles.check}>
              <input type="checkbox" checked={deep} onChange={(event) => setDeep(event.target.checked)} />
              <span>{endings.length === 0 ? t('dev.batch.deepAll') : t('dev.batch.deep', { endings: endings.map((ending) => `.${ending}`).join(', ') })}</span>
            </label>
            {files.length === 0 ? (
              <div className={frame.blank}>{t('dev.batch.empty')}</div>
            ) : (
              <ul className={styles.list}>
                {files.slice(0, drawn).map((file) => {
                  const { folder: where, name } = splitPath(file.path);
                  const item = results ? results.get(file.path) : checks.get(file.path);
                  return (
                    <li
                      key={file.path}
                      className={styles.file}
                      data-status={item?.status}
                      data-chosen={chosen?.path === file.path}
                      tabIndex={preview ? 0 : undefined}
                      aria-current={chosen?.path === file.path ? 'true' : undefined}
                      onClick={preview ? () => setChosen(file) : undefined}
                      onKeyDown={
                        preview
                          ? (event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return;
                              event.preventDefault();
                              setChosen(file);
                            }
                          : undefined
                      }
                    >
                      <span className={styles.status} aria-hidden="true">
                        <Icon name={item ? STATUS_ICONS[item.status] : 'file'} size={14} />
                      </span>
                      <span className={styles.texts}>
                        <bdi className={styles.name}>{name}</bdi>
                        <bdi className={styles.where}>{where}</bdi>
                        {item?.status === 'done' && item.said && (
                          <code className={styles.shown} dir="ltr">
                            {item.said}
                          </code>
                        )}
                      </span>
                      <span className={styles.said}>{item ? said(item) : formatBytes(file.size, language)}</span>
                    </li>
                  );
                })}
                {files.length > drawn && (
                  <li className={styles.more}>
                    <button type="button" className={frame.action} onClick={() => setDrawn(drawn + DRAWN_AT_ONCE)}>
                      {t('dev.batch.more', { count: count(files.length - drawn) })}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </section>
        }
        second={
          <section className={frame.pane} aria-label={t('dev.batch.results')}>
            <div className={frame.paneHead}>
              <span className={frame.paneTitle}>{t('dev.batch.results')}</span>
              <span className={frame.spring} />
              {results !== null && [...results.values()].some((item) => item.said) && (
                <button type="button" className={frame.action} onClick={copyShown}>
                  <Icon name={copied ? 'circle-check' : 'copy'} size={13} />
                  {t(copied ? 'dev.frame.copied' : 'dev.batch.copyAll')}
                </button>
              )}
              {folder !== null && kind === 'folder' && results !== null && (
                <button type="button" className={frame.action} onClick={() => void host.showInFolder(folder).catch(() => {})}>
                  <Icon name="folder-open" size={13} />
                  {t('dev.frame.showInFolder')}
                </button>
              )}
            </div>
            {checkTotals && (
              <div className={checkTotals.wrong + checkTotals.failed > 0 ? frame.wrong : frame.fine} role="status">
                <Icon name={checkTotals.wrong + checkTotals.failed > 0 ? 'triangle-exclamation' : 'circle-check'} size={15} />
                <span className={frame.wrongTexts}>
                  <span className={frame.wrongMessage}>{t('dev.batch.checked', { fine: count(checkTotals.done), wrong: count(checkTotals.wrong + checkTotals.failed) })}</span>
                  <span>{t('dev.batch.checkedNote')}</span>
                </span>
              </div>
            )}
            {totals && (
              <div className={totals.wrong + totals.failed > 0 ? frame.wrong : frame.fine} role="status">
                <Icon name={totals.wrong + totals.failed > 0 ? 'triangle-exclamation' : 'circle-check'} size={15} />
                <span className={frame.wrongTexts}>
                  <span className={frame.wrongMessage}>{t('dev.batch.summary', { done: count(totals.done), wrong: count(totals.wrong + totals.failed), skipped: count(totals.skipped) })}</span>
                  <span>{tellsOnly ? `${formatBytes(totals.bytesIn, language)} · ${formatDuration(took, language)}` : `${formatBytes(totals.bytesIn, language)} → ${formatBytes(totals.bytesOut, language)} · ${formatDuration(took, language)}`}</span>
                </span>
              </div>
            )}
            <div className={styles.targets}>
              {tellsOnly ? (
                <p className={styles.note}>{t('dev.batch.nothingWritten')}</p>
              ) : (
                <>
                  <span className={styles.heading}>{t('dev.batch.target')}</span>
                  <div role="radiogroup" aria-label={t('dev.batch.target')} className={styles.radios}>
                    {TARGET_KINDS.filter((value) => (value !== 'replace' || !naming.noReplace) && (value !== 'shown' || shows)).map((value) => (
                      <label key={value} className={styles.radio}>
                        <input type="radio" name="dev-batch-target" checked={kind === value} onChange={() => (value === 'folder' && folder === null ? void chooseFolder() : setKind(value))} />
                        <span className={styles.radioTexts}>
                          <span>{t(`dev.batch.target.${value}`, { example: naming.example })}</span>
                          {value === 'folder' && folder !== null && <bdi className={styles.where}>{folder}</bdi>}
                        </span>
                        {value === 'folder' && (
                          <button type="button" className={frame.action} onClick={() => void chooseFolder()}>
                            {t('dev.batch.chooseFolder')}
                          </button>
                        )}
                      </label>
                    ))}
                  </div>
                  <label className={styles.check} data-disabled={kind === 'replace' || kind === 'shown'}>
                    <input type="checkbox" checked={overwrite && kind !== 'replace' && kind !== 'shown'} disabled={kind === 'replace' || kind === 'shown'} onChange={(event) => setOverwrite(event.target.checked)} />
                    <span>{t('dev.batch.overwrite')}</span>
                  </label>
                </>
              )}
              {asking && (
                <div className={frame.wrong} role="alertdialog" aria-label={t('dev.batch.replaceAsk', { count: count(files.length) })}>
                  <Icon name="triangle-exclamation" size={15} />
                  <span className={frame.wrongTexts}>
                    <span className={frame.wrongMessage}>{t('dev.batch.replaceAsk', { count: count(files.length) })}</span>
                    <span>{t('dev.batch.replaceNote')}</span>
                  </span>
                  <button type="button" className={frame.burn} onClick={() => void runNow(true)}>
                    {t('dev.batch.replaceYes')}
                  </button>
                  <button type="button" className={frame.action} onClick={() => setAsking(false)}>
                    {t('dev.batch.replaceNo')}
                  </button>
                </div>
              )}
            </div>
            {preview && (
              <div className={styles.preview}>
                <span className={styles.heading}>{chosen ? <bdi>{t('dev.batch.preview', { name: splitPath(chosen.path).name })}</bdi> : t('dev.batch.preview', { name: '…' })}</span>
                {/* Not while the files are worked on: one run at a time. */}
                {chosen && !working ? <FilePreview host={host} layout={layout} path={chosen.path} size={chosen.size} optionsKey={optionsKey} {...preview} /> : <div className={frame.blank}>{t('dev.batch.previewHint')}</div>}
              </div>
            )}
          </section>
        }
      >
        {working && <ToolProgress host={host} title={workTitle} />}
      </SplitPanes>

      <div className={frame.status} role="status">
        <span>{t('dev.frame.notKept')}</span>
        <span className={frame.spring} />
        {told && (
          <span className={frame.last} data-problem={told.problem === true}>
            {t(told.key, told.values)}
          </span>
        )}
        <button type="button" className={frame.burn} data-tooltip={t('dev.hint.burn')} onClick={burn}>
          <Icon name="trash-can" size={12} />
          {t('dev.frame.burn')}
        </button>
      </div>
    </>
  );
}
