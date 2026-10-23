import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { editorPhrases, TextEditor } from '@syntelab/text-editor';
import type { EditorFacts, TextEditorHandle } from '@syntelab/text-editor';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { forgetResult, keepResult, newResultFile, problemKey, saveText, stopWork } from '../api/dev-api';
import { formatBytes, formatDuration } from './format';
import type { ToolLayout } from './layout';
import type { ToolActions } from './text-tool';
import styles from './tool-frame.module.css';
import { ToolProgress } from './tool-progress';

/** What the `generate` command of the Rust side answers. */
type GenerateAnswer =
  | { readonly ok: true; readonly text?: string; readonly head?: string; readonly count: number; readonly stats: { readonly bytesOut: number; readonly ms: number }; readonly notes: readonly { readonly code: string; readonly text: string }[] }
  | { readonly ok: false; readonly error: { readonly code: string } };

export interface GeneratorToolProps {
  readonly host: AppHost;
  readonly layout: ToolLayout;
  /** What is made, as the Rust side knows it, and how. */
  readonly tool: string;
  readonly request: Readonly<Record<string, unknown>>;
  /** How many are made, each on a line. */
  readonly count: number;
  /** About how many bytes one of them takes: more than can be shown in all goes to a file. */
  readonly bytesEach: number;
  /** What stands first in the line of options. */
  readonly lead?: ReactNode;
  /** The options of the tool, drawn in the line over the pane. */
  readonly options: ReactNode;
  /** How what was made is saved: its kind, its ending and its name. */
  readonly saves: { readonly typeName: string; readonly extension: string; readonly name: string };
  /** That it was made, in a few words, already translated. */
  readonly fine: string;
  /** What a note of the Rust side says, already translated; undefined for one the tool does not tell of. */
  readonly noteText?: (code: string, text: string) => string | undefined;
  readonly workTitle: string;
  readonly onActions: (actions: ToolActions | null) => void;
}

/** What is made is shown whole up to this size; beyond it, it goes to a file of the program's own, and its start is shown. */
const SHOWN_UP_TO = 16 * 1024 * 1024;
/** How long after the last change of an option what was made is made again. */
const RUN_AFTER = 300;
const NO_FACTS: EditorFacts = { changed: false, line: 1, column: 1, selected: 0, length: 0, lines: 1 };
const PASSED_KEYS = ['Mod-Enter'] as const;

/**
 * The frame of a tool that makes something from nothing given (identifiers,
 * passwords): its options, a button that makes, and what was made, to copy
 * or to save. Once something was made, it is made again whenever an option
 * changes. Nothing made is kept: it is in the pane until Burn, or until
 * the next making, and nowhere else. More than can be shown whole goes to a
 * file of the program's own: its start is shown, and Save copies it.
 */
export function GeneratorTool({ host, layout, tool, request, count, bytesEach, lead, options, saves, fine, noteText, workTitle, onActions }: GeneratorToolProps) {
  const { t, language } = useI18n();
  const output = useRef<TextEditorHandle>(null);
  const [facts, setFacts] = useState<EditorFacts>(NO_FACTS);
  const [made, setMade] = useState<Extract<GenerateAnswer, { ok: true }> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  /** The file of the program's own that holds what was made, when it is too much to be shown whole. */
  const [resultPath, setResultPath] = useState<string | null>(null);
  const resultHeld = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [told, setTold] = useState<{ readonly key: string; readonly values?: Record<string, string>; readonly problem?: boolean } | null>(null);
  const [working, setWorking] = useState(false);
  /** Changes when the pane is made anew: Burn takes what its editor could undo with it. */
  const [generation, setGeneration] = useState(0);
  const sequence = useRef(0);
  const phrases = useMemo(() => editorPhrases(t), [t]);
  const number = (value: number) => new Intl.NumberFormat(language).format(value);

  /** Holds another file of what was made, or none; the one held before is deleted. */
  const holdResult = (next: string | null) => {
    if (resultHeld.current !== null && resultHeld.current !== next) forgetResult(host, resultHeld.current);
    resultHeld.current = next;
    setResultPath(next);
  };

  const run = async () => {
    clearTimeout(timer.current);
    const mine = ++sequence.current;
    setTold(null);
    let out: string | undefined;
    setWorking(count > 20_000);
    try {
      // Too many to show whole: they go to a file of the program's own, and their start is shown.
      if (count * bytesEach > SHOWN_UP_TO) out = await newResultFile(host);
      const answer = await host.invoke<GenerateAnswer>('generate', { tool, options: request, count, out });
      if (mine !== sequence.current) {
        if (out !== undefined) forgetResult(host, out);
        return;
      }
      setSavedTo(null);
      if (!answer.ok) {
        if (out !== undefined) forgetResult(host, out);
        holdResult(null);
        setMade(null);
        setProblem(`dev.generate.problem.${answer.error.code}`);
        output.current?.show('');
        return;
      }
      holdResult(out ?? null);
      setProblem(null);
      setMade(answer);
      output.current?.show(answer.text ?? answer.head ?? '');
    } catch (error) {
      if (out !== undefined) forgetResult(host, out);
      if (mine !== sequence.current) return;
      holdResult(null);
      setMade(null);
      output.current?.show('');
      setTold({ key: problemKey(error), problem: true });
    } finally {
      if (mine === sequence.current) setWorking(false);
    }
  };

  // Once something was made, it is made again as the options change (a moment after the last change: a number is typed a key at a time).
  const optionsKey = JSON.stringify([tool, request, count]);
  const firstOptions = useRef(true);
  useEffect(() => {
    if (firstOptions.current) {
      firstOptions.current = false;
      return;
    }
    if (made === null && problem === null) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void latest.current.run(), RUN_AFTER);
  }, [optionsKey]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (resultHeld.current !== null) forgetResult(host, resultHeld.current);
    },
    [],
  );

  /** What was made is in the pane, whole or (held in a file) its start. */
  const has = made !== null && (resultPath !== null || facts.length > 0);
  const copy = () => {
    if (!has || resultPath !== null) return;
    void navigator.clipboard.writeText(output.current?.text() ?? '').then(
      () => setTold({ key: 'dev.frame.copied' }),
      () => setTold({ key: 'dev.problem.clipboard', problem: true }),
    );
  };

  const save = async () => {
    if (!has) return;
    const path = await host.pickSavePath({ typeName: saves.typeName, extension: saves.extension, suggestedName: saves.name });
    if (path === null) return;
    try {
      if (resultPath !== null) await keepResult(host, resultPath, path);
      else await saveText(host, path, output.current?.text() ?? '');
      setSavedTo(path);
      setTold({ key: 'dev.frame.saved', values: { path } });
    } catch (error) {
      setTold({ key: problemKey(error), problem: true });
    }
  };

  const burn = () => {
    sequence.current += 1;
    clearTimeout(timer.current);
    holdResult(null);
    if (working) void stopWork(host).catch(() => {});
    setWorking(false);
    setMade(null);
    setProblem(null);
    setSavedTo(null);
    setFacts(NO_FACTS);
    setGeneration((value) => value + 1);
    setTold({ key: 'dev.frame.burnt' });
  };

  // The commands of the program reach what these do now, not what they did when they were made.
  const latest = useRef({ run, save, copy, burn });
  latest.current = { run, save, copy, burn };
  useEffect(() => {
    onActions({ run: () => void latest.current.run(), open: () => {}, save: () => void latest.current.save(), copy: () => latest.current.copy(), burn: () => latest.current.burn() });
    return () => onActions(null);
  }, [onActions]);

  const notes = made?.notes.map((note) => noteText?.(note.code, note.text)).filter((note): note is string => note !== undefined) ?? [];

  return (
    <>
      <div className={styles.options}>
        {lead}
        {options}
        <span className={styles.spring} />
        <button type="button" className={styles.run} disabled={working || count < 1} data-tooltip={t('dev.hint.run')} onClick={() => void run()}>
          <Icon name="bolt" size={13} />
          {t('dev.generate.run')}
        </button>
      </div>
      <section className={styles.pane} aria-label={t('dev.frame.output')} style={{ position: 'relative', flex: 1 }}>
        <div className={styles.paneHead}>
          <span className={styles.paneTitle}>{t('dev.frame.output')}</span>
          {has && resultPath === null && <span className={styles.paneFacts}>{t('dev.frame.size', { characters: number(facts.length), lines: number(facts.lines) })}</span>}
          {made !== null && resultPath !== null && <span className={styles.paneFacts}>{formatBytes(made.stats.bytesOut, language)}</span>}
          <span className={styles.spring} />
          <button type="button" className={styles.action} disabled={!has || resultPath !== null} onClick={copy}>
            <Icon name="copy" size={13} />
            {t('dev.frame.copy')}
          </button>
          <button type="button" className={styles.action} disabled={!has} onClick={() => void save()}>
            <Icon name="floppy-disk" size={13} />
            {t('dev.frame.saveFile')}
          </button>
          {savedTo !== null && (
            <button type="button" className={styles.action} onClick={() => void host.showInFolder(savedTo).catch(() => {})}>
              <Icon name="folder-open" size={13} />
              {t('dev.frame.showInFolder')}
            </button>
          )}
        </div>
        {problem !== null && (
          <div className={styles.wrong} role="alert">
            <Icon name="triangle-exclamation" size={15} />
            <span className={styles.wrongTexts}>
              <span className={styles.wrongMessage}>{t(problem)}</span>
            </span>
          </div>
        )}
        {made && (
          <div className={styles.fine} role="status">
            <Icon name="circle-check" size={15} />
            <span className={styles.wrongTexts}>
              <span className={styles.wrongMessage}>{fine}</span>
              <span>{t('dev.generate.made', { count: number(made.count), size: formatBytes(made.stats.bytesOut, language), time: formatDuration(made.stats.ms, language) })}</span>
              {notes.map((note) => (
                <span key={note}>{note}</span>
              ))}
            </span>
          </div>
        )}
        {made !== null && resultPath !== null && (
          <div className={styles.fileNote}>
            <Icon name="file" size={15} />
            <span className={styles.fileTexts}>
              <span className={styles.fileName}>{t('dev.frame.resultStart', { size: formatBytes(made.stats.bytesOut, language) })}</span>
              <span>{t('dev.frame.resultStartNote')}</span>
            </span>
          </div>
        )}
        <div className={styles.editor}>
          <TextEditor key={generation} ref={output} initialText="" wrap={layout.wrap} lineNumbers={layout.lineNumbers} readOnly passKeys={PASSED_KEYS} phrases={phrases} emptyHint={t('dev.generate.empty')} onFacts={setFacts} />
        </div>
        {working && <ToolProgress host={host} title={workTitle} />}
      </section>
      <div className={styles.status} role="status">
        <span>{t('dev.frame.notKept')}</span>
        <span className={styles.spring} />
        {told && (
          <span className={styles.last} data-problem={told.problem === true}>
            {t(told.key, told.values)}
          </span>
        )}
        <button type="button" className={styles.burn} data-tooltip={t('dev.hint.burn')} onClick={burn}>
          <Icon name="trash-can" size={12} />
          {t('dev.frame.burn')}
        </button>
      </div>
    </>
  );
}
