import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { editorPhrases, TextEditor } from '@syntelab/text-editor';
import type { EditorFacts, Syntax, TextEditorHandle } from '@syntelab/text-editor';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fileAsBase64, forgetResult, keepResult, newResultFile, openFile, problemKey, saveText, stopWork } from '../api/dev-api';
import { BytesPreview } from './bytes-preview';
import { formatBytes } from './format';
import { CsvTable } from './csv-table';
import { takeHanded } from './handed';
import { JsonTree } from './json-tree';
import type { ToolLayout } from './layout';
import { COPIED_MOST, fileRunsByItself, showResult, TEXT_RUN_BY_ITSELF_UP_TO } from './result-file';
import type { ShownResult } from './result-file';
import { SplitPanes } from './split-panes';
import { ToolProgress } from './tool-progress';
import styles from './tool-frame.module.css';

/** What a tool is run on: a text, or a file read from where it is on disk; and, for a result that goes to a file, where it is written. */
export type ToolInput = { readonly text: string; readonly out?: string } | { readonly path: string; readonly out?: string };

/** What a tool answers: a result, or what is wrong with what it was given and where. */
export type ToolOutcome =
  | {
      readonly ok: true;
      /** The result, for a text. */
      readonly text?: string | null;
      /** The start of the result, for a file written to disk. */
      readonly head?: string | null;
      /** The result of a text is bytes that are no text: it is not in `text`, and is run again into a file to be shown from there. */
      readonly binary?: boolean;
      /** How large the result is, in bytes. */
      readonly size?: number;
      /** All is not well after all (a signature that does not hold): the result is there, and is told of as a problem. */
      readonly warning?: boolean;
      /** Things worth telling of besides (names that were not known…), each a line, already translated. */
      readonly notes?: readonly string[];
      /** That nothing is wrong with what the tool was given, in a few words, already translated: said over the result. */
      readonly fine: string;
      /** What else is said of the run (how much, how long), already translated. */
      readonly summary: string;
    }
  | {
      readonly ok: false;
      /** Already translated. */
      readonly message: string;
      /** From 1; 0 when the problem has no place in the text. */
      readonly line: number;
      readonly column: number;
      /** The place in the text, from 0, as the editor counts. */
      readonly offset: number;
    };

/** A file a tool hands to a pane to be opened there. It is opened once, however many times the pane is made anew. */
export interface FileToLoad {
  readonly path: string;
}

/** A text a tool puts into the input (a schedule that was built): in place of what is there, or as one more line. Each such object is put once. */
export interface TextToPut {
  readonly text: string;
  readonly add: boolean;
}

const put = new WeakSet<TextToPut>();

/** The largest file that is taken when it is dropped and the window does not say where it is: beyond it a file is read from disk, with Open a file. */
const DROPPED_MOST = 16 * 1024 * 1024;

/** The files handed over that were opened already. */
const loaded = new WeakSet<FileToLoad>();

/** Whether a file handed over is still to be opened; asking marks it as opened. */
export function takeLoad(load: FileToLoad | undefined): load is FileToLoad {
  if (!load || loaded.has(load)) return false;
  loaded.add(load);
  return true;
}

/** What the commands of the program do with the tool that is open. */
export interface ToolActions {
  run(): void;
  open(): void;
  save(): void;
  copy(): void;
  burn(): void;
}

export interface TextToolProps {
  readonly host: AppHost;
  readonly layout: ToolLayout;
  /** Shown and at work; false while the tool works on many files instead, and this is only kept as it was. */
  readonly active: boolean;
  /** What stands first in the line of options (the choice between a text and many files). */
  readonly lead?: ReactNode;
  /** The options of the tool, drawn in the line over the panes. */
  readonly options: ReactNode;
  /** Changes whenever the options do: the tool is then run again. */
  readonly optionsKey: string;
  /** As the options are now, the tool only tells something of what it is given: there is no result to copy or save. */
  readonly tellsOnly: boolean;
  /** Runs the tool. Rejects with what `host.invoke` rejects with. */
  readonly run: (input: ToolInput) => Promise<ToolOutcome>;
  /** Only reads what it is given and says whether the tool takes it: a file worked on from disk is told so the moment it is opened. */
  readonly check?: (input: ToolInput) => Promise<ToolOutcome>;
  /** The tool takes any bytes: a file that is not text is opened too, and worked on from disk. */
  readonly takesBytes?: boolean;
  /** What is given is JSON, and can be shown as a tree that folds beside the result. `lenient`: comments and last commas are let by. */
  readonly tree?: { readonly lenient: boolean };
  /** What is given (`input`), or what comes out (`result`), is CSV, and can be shown as a table in the pane of the result. */
  readonly table?: { readonly of: 'input' | 'result'; readonly separator: string; readonly header: boolean };
  /** One more way of looking at the result, drawn by the tool (two texts side by side). `resultLabel`: what the result itself is called beside it; `first`: it is what the pane shows until another is chosen. */
  readonly extra?: { readonly label: string; readonly resultLabel?: string; readonly first?: boolean; readonly view: ReactNode };
  /** A text to put into the input without it being typed. */
  readonly put?: TextToPut;
  /** The result is short whatever is given (digests): that of a file comes back as a text, and is not written to a file first. */
  readonly resultFits?: boolean;
  /** A file to put into the tool without asking for it: each such object is opened once. */
  readonly load?: FileToLoad;
  /** What is given, and what comes out, is code of this language: the editors colour it. */
  readonly inputSyntax?: Syntax;
  readonly outputSyntax?: Syntax;
  /** A second text the tool needs, drawn under the input (a schema). Given the number that changes when the tool is burnt, to be made anew by. */
  readonly below?: (generation: number, burns: number) => ReactNode;
  /** The kind of files offered when one is opened. */
  readonly opens: { readonly typeName: string; readonly extensions: readonly string[] };
  /** How a result is saved: its kind, and the name it is offered under (from the name of the file that was opened, when one was). */
  readonly saves: { readonly typeName: string; readonly extension: string; readonly name: (inputName: string | null) => string };
  /** What the card over the tool is titled with while long work lasts, already translated. */
  readonly workTitle: string;
  /** Gives the program what its commands do with this tool; null when the tool goes away. */
  readonly onActions: (actions: ToolActions | null) => void;
}

/** A file too large to be shown whole, or not text: it stays on disk, and the tool reads it from there. */
interface LargeFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly head: string;
  /** The file is not text: it has no start to show, and a preview of its bytes is shown instead. */
  readonly binary: boolean;
}

/** A result written to a file of the program's own: where it is, and how it is shown. Save copies it. */
interface ResultFile {
  readonly path: string;
  readonly shown: ShownResult['as'];
  readonly size: number;
}

/** Something said in the line under the tool: a key of the translations, with what it needs. */
interface Told {
  readonly key: string;
  readonly values?: Readonly<Record<string, string>>;
  readonly problem?: boolean;
}

/** How long after the last change a text is run. */
const RUN_AFTER = 300;
/** Ctrl+Enter runs the tool: the editors leave it to that command. */
const PASSED_KEYS = ['Mod-Enter'] as const;

const NO_FACTS: EditorFacts = { changed: false, line: 1, column: 1, selected: 0, length: 0, lines: 1 };

/**
 * The frame of a tool that takes a text and gives a text: what goes in, what
 * comes out, the options over them and a line under them. A tool gives its
 * options and what running it does; everything else is here, once.
 *
 * Nothing has a most. What is given is run again whenever it changes and
 * whenever an option does: a text as it is typed while it is short (a very
 * long one waits for the Run button, which shows only then), a file that stays
 * on disk as it is opened while it is not very large. The command of the
 * program, Ctrl+Enter, runs the tool at any time. A file too large to be shown
 * stays on disk: the tool reads it from there, with a card that tells how far
 * it has got and can stop it, and writes its result to a file of the
 * program's own, shown from there (its start, or a preview of its bytes)
 * until Save copies it to where the user says. So is a result of a text that
 * is bytes and no text.
 *
 * Nothing that is typed, pasted or opened is kept: Burn empties the tool,
 * the history of its editors with it.
 */
export function TextTool({ host, layout, active, lead, options, optionsKey, tellsOnly, run, check, takesBytes, inputSyntax, outputSyntax, below, tree, table, extra, load, put: toPut, resultFits, opens, saves, workTitle, onActions }: TextToolProps) {
  const { t, language } = useI18n();
  const input = useRef<TextEditorHandle>(null);
  const output = useRef<TextEditorHandle>(null);
  /** Changes when the editors are made anew: a file was opened, or the tool was burnt. */
  const [generation, setGeneration] = useState(0);
  /** How many times the tool was burnt: what a pane that outlives a file being opened is made anew by. */
  const [burns, setBurns] = useState(0);
  /** What the input editor is made with. */
  const [initial, setInitial] = useState('');
  const [file, setFile] = useState<LargeFile | null>(null);
  /** What the check of the file that stays on disk came to; null while it is not known. */
  const [checked, setChecked] = useState<ToolOutcome | null>(null);
  /** The name of the file the text came from, when it came from one: the result is offered a name made from it. */
  const [inputName, setInputName] = useState<string | null>(null);
  /** How the file in the input was written, when that was not UTF-8. */
  const [readAs, setReadAs] = useState<string | null>(null);
  const [facts, setFacts] = useState<EditorFacts>(NO_FACTS);
  const [outputFacts, setOutputFacts] = useState<EditorFacts>(NO_FACTS);
  const [outcome, setOutcome] = useState<ToolOutcome | null>(null);
  /** Where the result was last saved. */
  const [savedTo, setSavedTo] = useState<string | null>(null);
  /** The file of the program's own that holds the result shown, when it is held so. */
  const [resultFile, setResultFile] = useState<ResultFile | null>(null);
  const resultHeld = useRef<ResultFile | null>(null);
  /** The run of a file that is going on: a new one waits for it to stop. */
  const running = useRef<Promise<void> | null>(null);
  const [told, setTold] = useState<Told | null>(null);
  /** What is shown is no longer the result of what is given: the tool waits for Run. */
  const [stale, setStale] = useState(false);
  const [working, setWorking] = useState(false);
  /** What the result pane shows: the result, or the document as a tree. */
  const [shows, setShows] = useState<'result' | 'tree' | 'table' | 'extra'>(extra?.first ? 'extra' : 'result');
  /** What the last run wrote: a text, or the file it went to. What the table of a result is of. */
  const [wrote, setWrote] = useState<ToolInput | null>(null);
  /** What was last run and found right: what the tree is of. */
  const [ran, setRan] = useState<ToolInput | null>(null);
  /** Each run has a number: an answer that is not the last one's is dropped. */
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const length = useRef(0);
  const phrases = useMemo(() => editorPhrases(t), [t]);
  // A file that stays on disk is looked at as a table as soon as it is opened: it need not be run first.
  const filePath = file?.path ?? null;
  const fileSource = useMemo((): ToolInput | null => (filePath === null ? null : { path: filePath }), [filePath]);

  /** Shows another result held in a file of the program's own, or none; the one shown before is deleted. */
  const holdResult = (next: ResultFile | null) => {
    const before = resultHeld.current;
    if (before && before.path !== next?.path) forgetResult(host, before.path);
    resultHeld.current = next;
    setResultFile(next);
  };

  const forget = () => {
    sequence.current += 1;
    clearTimeout(timer.current);
    // A file that was being worked on is no longer of any use.
    if (running.current) void stopWork(host).catch(() => {});
    holdResult(null);
    setOutcome(null);
    setRan(null);
    setWrote(null);
    setChecked(null);
    setSavedTo(null);
    setTold(null);
    setStale(false);
    setWorking(false);
  };

  /** A file that stays on disk is read once as soon as it is opened, to say whether the tool takes it. */
  const checkFile = async (path: string) => {
    if (!check) return;
    const mine = sequence.current;
    setWorking(true);
    try {
      const result = await check({ path });
      if (mine === sequence.current) setChecked(result);
    } catch (error) {
      if (mine === sequence.current) setTold({ key: problemKey(error), problem: true });
    } finally {
      if (mine === sequence.current) setWorking(false);
    }
  };

  const runNow = async () => {
    clearTimeout(timer.current);
    const mine = ++sequence.current;
    const current = () => mine === sequence.current;
    setTold(null);
    let request: ToolInput;
    if (file) {
      // One file at a time: the run that is going on is stopped, and the new one waits for it to end.
      if (running.current) {
        void stopWork(host).catch(() => {});
        await running.current;
        if (!current()) return;
      }
      request = { path: file.path };
    } else {
      const text = input.current?.text() ?? '';
      if (text.trim() === '') {
        holdResult(null);
        setRan(null);
        setWrote(null);
        setOutcome(null);
        setStale(false);
        output.current?.show('');
        input.current?.mark([]);
        return;
      }
      request = { text };
    }
    // The card is for work that may last. A short text is run while it is typed, and nothing must come between the keys and the editor.
    const long = 'path' in request || request.text.length > TEXT_RUN_BY_ITSELF_UP_TO;
    if (long) setWorking(true);
    setStale(false);
    /** The file of the program's own the result goes to, once there is one. */
    const made: { out: string | null } = { out: null };
    const given = request;
    const work = (async () => {
      // The result of a file goes to a file of the program's own, unless the tool only tells something, or its result is short.
      if ('path' in given && !tellsOnly && !resultFits) made.out = await newResultFile(host);
      let result = await run(made.out === null ? given : { ...given, out: made.out });
      // Bytes that no text box can hold: the text is run once more, into a file of the program's own, to be shown from there.
      if (result.ok && result.binary === true && 'text' in given && current()) {
        made.out = await newResultFile(host);
        result = await run({ text: given.text, out: made.out });
      }
      const shown: ShownResult | null = !result.ok ? null : typeof result.text === 'string' ? { as: 'text', text: result.text, size: result.size ?? 0 } : made.out !== null ? await showResult(host, made.out).catch(() => null) : null;
      return { result, shown };
    })();
    if (file) {
      const settled = work.then(
        () => {},
        () => {},
      );
      running.current = settled;
      void settled.then(() => {
        if (running.current === settled) running.current = null;
      });
    }
    try {
      const { result, shown } = await work;
      if (!current()) {
        if (made.out !== null) forgetResult(host, made.out);
        return;
      }
      setOutcome(result);
      // The tree is of what was given: the text as it was run, or the file where it is.
      setRan(result.ok ? ('path' in given ? { path: given.path } : { text: given.text }) : null);
      // A result the tool gave as a text never went to the file it was given (or none was made).
      const held = result.ok && typeof result.text !== 'string' && made.out !== null && shown !== null ? made.out : null;
      if (made.out !== null && held === null) forgetResult(host, made.out);
      holdResult(held === null || shown === null ? null : { path: held, shown: shown.as, size: shown.size });
      setWrote(!result.ok ? null : held !== null ? { path: held } : typeof result.text === 'string' ? { text: result.text } : null);
      setStale(false);
      setSavedTo(null);
      output.current?.show(shown && shown.as !== 'bytes' ? shown.text : '');
      if (result.ok || file) {
        input.current?.mark([]);
      } else {
        const end = length.current;
        const from = Math.min(result.offset, Math.max(end - 1, 0));
        input.current?.mark(end === 0 ? [] : [{ from, to: Math.min(from + 1, end) }]);
      }
    } catch (error) {
      if (made.out !== null) forgetResult(host, made.out);
      if (!current()) return;
      holdResult(null);
      setOutcome(null);
      setWrote(null);
      setSavedTo(null);
      output.current?.show('');
      setTold({ key: problemKey(error), problem: true });
    } finally {
      if (current()) setWorking(false);
    }
  };

  /** What is given changed: a short text is run after a moment, a long one or a file waits for Run. */
  const changed = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!file && length.current <= TEXT_RUN_BY_ITSELF_UP_TO) {
        void latest.current.runNow();
        return;
      }
      // What was wrong may be so no longer: it is not said of a text that changed since.
      setOutcome((now) => (now && !now.ok ? null : now));
      input.current?.mark([]);
      setStale(true);
    }, RUN_AFTER);
  };

  /** Starts the input anew with a text (its editor is made again: what it could undo is gone). */
  const startWith = (text: string, name: string | null) => {
    forget();
    setReadAs(null);
    setFile(null);
    setInputName(name);
    setInitial(text);
    setGeneration((value) => value + 1);
  };

  /**
   * A file dropped on the input. Where the window says where it is on disk, it is opened as one chosen with "Open
   * a file" is. Else the interface has only what is in it, and it is taken as a text that was pasted: whole, when
   * it is small enough to be shown and is text. A larger one, or one that is not text, is opened with "Open a file".
   */
  const drop = async (dropped: File) => {
    const [path] = (await host.pathsOfDropped([dropped]).catch(() => null)) ?? [];
    if (path !== undefined) return openAt(path);
    if (dropped.size > DROPPED_MOST) return setTold({ key: 'dev.frame.dropTooLarge', problem: true });
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await dropped.arrayBuffer());
      startWith(text, dropped.name);
    } catch {
      setTold({ key: 'dev.frame.dropNotText', problem: true });
    }
  };

  const open = async () => {
    const [path] = await host.pickFiles({ typeName: opens.typeName, extensions: opens.extensions });
    if (path !== undefined) await openAt(path);
  };

  const openAt = async (path: string) => {
    try {
      const opened = await openFile(host, path, takesBytes === true);
      if (opened.large) {
        forget();
        setInitial('');
        setInputName(opened.name);
        setFile({ path, name: opened.name, size: opened.size, head: opened.head ?? '', binary: opened.binary === true });
        setGeneration((value) => value + 1);
        // One that is not very large is run as soon as it is opened (below); a larger one is only checked, and waits for Run.
        if (!fileRunsByItself(opened.size)) {
          setStale(true);
          void checkFile(path);
        }
      } else {
        startWith(opened.text ?? '', opened.name);
        // Read from another encoding: said beside the input for as long as it is there, since what is saved from here is UTF-8.
        setReadAs(opened.encoding ?? null);
      }
    } catch (error) {
      setTold({ key: problemKey(error), problem: true });
    }
  };

  // A text handed over from the first page is what the tool starts with.
  useEffect(() => {
    const given = takeHanded();
    if (given !== null) startWith(given, null);
  }, []);

  // A text the tool puts in takes the place of what is there, or goes after it on a line of its own.
  useEffect(() => {
    if (!toPut || put.has(toPut)) return;
    put.add(toPut);
    const before = file ? '' : (input.current?.text() ?? '');
    const text = toPut.add && before.trim() !== '' ? `${before.replace(/\n+$/, '')}\n${toPut.text}\n` : `${toPut.text}\n`;
    if (file) startWith(text, null);
    else input.current?.replace(text);
  }, [toPut]);

  // A file handed over by the tool (a pair chosen among two folders) is opened as one chosen by the user is.
  useEffect(() => {
    if (takeLoad(load)) void openAt(load.path);
  }, [load]);

  const paste = () =>
    void navigator.clipboard.readText().then(
      (pasted) => {
        if (pasted === '') return;
        if (file) startWith(pasted, null);
        else input.current?.replace(pasted);
      },
      () => setTold({ key: 'dev.problem.clipboard', problem: true }),
    );

  const clear = () => {
    if (file) startWith('', null);
    else input.current?.replace('');
    setInputName(null);
  };

  /** The result is in the output editor, whole. */
  const hasText = outcome?.ok === true && (resultFile === null || resultFile.shown === 'text') && outputFacts.length > 0;
  /** The result is bytes held in a file of the program's own: what is copied is their Base64. */
  const bytesResult = outcome?.ok === true && resultFile?.shown === 'bytes';
  const canCopy = hasText || (bytesResult && (resultFile?.size ?? 0) <= COPIED_MOST);
  const canSave = outcome?.ok === true && !tellsOnly && (hasText || resultFile !== null);

  const copy = async () => {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(bytesResult && resultFile ? await fileAsBase64(host, resultFile.path) : (output.current?.text() ?? ''));
      setTold({ key: bytesResult ? 'dev.frame.copiedBase64' : 'dev.frame.copied' });
    } catch {
      setTold({ key: 'dev.problem.clipboard', problem: true });
    }
  };

  const save = async () => {
    if (!canSave) return;
    const path = await host.pickSavePath({ typeName: saves.typeName, extension: saves.extension, suggestedName: saves.name(inputName) });
    if (path === null) return;
    try {
      // A result held in a file of the program's own is copied as it is; a text is written as UTF-8.
      if (resultFile) await keepResult(host, resultFile.path, path);
      else await saveText(host, path, output.current?.text() ?? '');
      setSavedTo(path);
      setTold({ key: 'dev.frame.saved', values: { path } });
    } catch (error) {
      setTold({ key: problemKey(error), problem: true });
    }
  };

  const burn = () => {
    if (working) void stopWork(host).catch(() => {});
    startWith('', null);
    setBurns((value) => value + 1);
    setFacts(NO_FACTS);
    setOutputFacts(NO_FACTS);
    setTold({ key: 'dev.frame.burnt' });
  };

  // The commands of the program and the timers reach what these do now, not what they did when they were made.
  const latest = useRef({ runNow, open, save, copy, burn });
  latest.current = { runNow, open, save, copy, burn };

  useEffect(() => {
    if (!active) return;
    onActions({
      run: () => void latest.current.runNow(),
      open: () => void latest.current.open(),
      save: () => void latest.current.save(),
      copy: () => void latest.current.copy(),
      burn: () => latest.current.burn(),
    });
    return () => onActions(null);
  }, [onActions, active]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      // The result held for the tool goes with it.
      if (resultHeld.current) forgetResult(host, resultHeld.current.path);
    },
    [],
  );

  /** A file that stays on disk is run by itself while it is not very large; a text is run by itself whatever its length, when it is not typed. */
  const fileWaits = file !== null && !fileRunsByItself(file.size);
  // A text the input was started with, or a file that was opened, is run at once; so is what is there when the options change.
  const firstOptions = useRef(true);
  useEffect(() => {
    if (file ? !fileWaits : initial !== '') void latest.current.runNow();
  }, [generation]);
  useEffect(() => {
    if (firstOptions.current) {
      firstOptions.current = false;
      return;
    }
    if (fileWaits) setStale(true);
    else void latest.current.runNow();
  }, [optionsKey]);

  /** Only a very long text being typed, or a very large file, waits for Run: anything else is run by itself. */
  const waits = file !== null ? fileWaits : facts.length > TEXT_RUN_BY_ITSELF_UP_TO;
  const said = told ?? (outcome && !outcome.ok ? { key: 'dev.frame.notRun', problem: true } : stale && (file !== null || facts.length > 0) ? { key: 'dev.frame.runAgain' } : null);
  const count = (value: number) => new Intl.NumberFormat(language).format(value);

  return (
    <>
      <div className={styles.options}>
        {lead}
        {options}
        <span className={styles.spring} />
        {/* Only where the tool does not run by itself: a very large file, a text too long to run at every key. Else it is said that it does. */}
        {waits ? (
          <button type="button" className={styles.run} disabled={working} data-tooltip={t('dev.hint.run')} onClick={() => void runNow()}>
            <Icon name="bolt" size={13} />
            {t('dev.frame.run')}
          </button>
        ) : (
          <span className={styles.live} data-tooltip={t('dev.hint.live')}>
            <Icon name="bolt" size={12} />
            {t('dev.frame.live')}
          </span>
        )}
      </div>

      <SplitPanes
        layout={layout}
        first={
        <section
          className={styles.pane}
          aria-label={t('dev.frame.input')}
          onDragOver={(event) => {
            // Only files are taken; a text dragged within the editor is the editor's own matter.
            if (event.dataTransfer.types.includes('Files')) event.preventDefault();
          }}
          onDrop={(event) => {
            const [dropped] = event.dataTransfer.files;
            if (dropped === undefined) return;
            event.preventDefault();
            void drop(dropped);
          }}
        >
          <div className={styles.paneHead}>
            <span className={styles.paneTitle}>{t('dev.frame.input')}</span>
            {!file && facts.length > 0 && <span className={styles.paneFacts}>{t('dev.frame.size', { characters: count(facts.length), lines: count(facts.lines) })}</span>}
            {!file && readAs !== null && <span className={styles.paneFacts}>{t('dev.frame.readAs', { encoding: readAs })}</span>}
            <span className={styles.spring} />
            <button type="button" className={styles.action} onClick={() => void open()}>
              <Icon name="folder-open" size={13} />
              {t('dev.frame.openFile')}
            </button>
            <button type="button" className={styles.action} onClick={paste}>
              <Icon name="paste" size={13} />
              {t('dev.frame.paste')}
            </button>
            <button type="button" className={styles.action} disabled={!file && facts.length === 0} onClick={clear}>
              <Icon name="eraser" size={13} />
              {t('dev.frame.clear')}
            </button>
          </div>
          {file && (
            <div className={styles.fileNote}>
              <Icon name="file" size={15} />
              <span className={styles.fileTexts}>
                <bdi className={styles.fileName}>{file.name}</bdi>
                <span>{t(file.binary ? 'dev.frame.bytesFile' : 'dev.frame.largeFile', { size: formatBytes(file.size, language) })}</span>
              </span>
            </div>
          )}
          {file && checked && !checked.ok && (
            <div className={styles.wrong} role="alert">
              <Icon name="triangle-exclamation" size={15} />
              <span className={styles.wrongTexts}>
                <span className={styles.wrongMessage}>{checked.message}</span>
                {checked.line > 0 && <span>{t('dev.frame.place', { line: count(checked.line), column: count(checked.column) })}</span>}
              </span>
            </div>
          )}
          {file && checked?.ok && (
            <div className={styles.fine} role="status">
              <Icon name="circle-check" size={15} />
              <span className={styles.wrongTexts}>
                <span className={styles.wrongMessage}>{checked.fine}</span>
                <span>{checked.summary}</span>
              </span>
            </div>
          )}
          <div className={styles.editor}>
            {file?.binary ? (
              <BytesPreview host={host} path={file.path} />
            ) : file ? (
              <TextEditor key={`head-${generation}`} syntax={inputSyntax} initialText={file.head} wrap={layout.wrap} lineNumbers={layout.lineNumbers} readOnly passKeys={PASSED_KEYS} phrases={phrases} onFacts={() => {}} />
            ) : (
              <TextEditor
                key={`in-${generation}`}
                ref={input}
                syntax={inputSyntax}
                initialText={initial}
                wrap={layout.wrap}
                lineNumbers={layout.lineNumbers}
                passKeys={PASSED_KEYS}
                phrases={phrases}
                emptyHint={t('dev.frame.inputEmpty')}
                onFacts={(now) => {
                  length.current = now.length;
                  setFacts(now);
                }}
                onChange={changed}
              />
            )}
          </div>
          {below?.(generation, burns)}
        </section>
        }
        second={
        <section className={styles.pane} aria-label={t('dev.frame.output')}>
          <div className={styles.paneHead}>
            <span className={styles.paneTitle}>{t('dev.frame.output')}</span>
            {(tree || table || extra) && (
              <span role="radiogroup" aria-label={t('dev.frame.shows')} className={styles.shows}>
                {(['extra', 'result', 'tree', 'table'] as const).filter((value) => value === 'result' || (value === 'tree' ? tree : value === 'table' ? table : extra) !== undefined).map((value) => (
                  <button key={value} type="button" role="radio" aria-checked={shows === value} onClick={() => setShows(value)}>
                    {value === 'extra' ? extra?.label : value === 'result' && extra?.resultLabel ? extra.resultLabel : t(`dev.frame.shows.${value}`)}
                  </button>
                ))}
              </span>
            )}
            {hasText && <span className={styles.paneFacts}>{t('dev.frame.size', { characters: count(outputFacts.length), lines: count(outputFacts.lines) })}</span>}
            {outcome?.ok && resultFile && resultFile.shown !== 'text' && <span className={styles.paneFacts}>{formatBytes(resultFile.size, language)}</span>}
            <span className={styles.spring} />
            <button type="button" className={styles.action} disabled={!canCopy} data-tooltip={bytesResult ? t('dev.hint.copyBase64') : undefined} onClick={() => void copy()}>
              <Icon name="copy" size={13} />
              {t(bytesResult ? 'dev.frame.copyBase64' : 'dev.frame.copy')}
            </button>
            <button type="button" className={styles.action} disabled={!canSave} onClick={() => void save()}>
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
          {outcome && !outcome.ok && (
            <div className={styles.wrong} role="alert">
              <Icon name="triangle-exclamation" size={15} />
              <span className={styles.wrongTexts}>
                <span className={styles.wrongMessage}>{outcome.message}</span>
                {outcome.line > 0 && <span>{t('dev.frame.place', { line: count(outcome.line), column: count(outcome.column) })}</span>}
              </span>
              {!file && outcome.line > 0 && (
                <button type="button" className={styles.action} onClick={() => input.current?.goTo(outcome.offset)}>
                  {t('dev.frame.goThere')}
                </button>
              )}
            </div>
          )}
          {outcome?.ok && !stale && (
            <div className={outcome.warning ? styles.wrong : styles.fine} role="status">
              <Icon name={outcome.warning ? 'triangle-exclamation' : 'circle-check'} size={15} />
              <span className={styles.wrongTexts}>
                <span className={styles.wrongMessage}>{outcome.fine}</span>
                <span>{outcome.summary}</span>
                {outcome.notes?.map((note) => <span key={note}>{note}</span>)}
              </span>
            </div>
          )}
          {outcome?.ok && resultFile?.shown === 'start' && (
            <div className={styles.fileNote}>
              <Icon name="file" size={15} />
              <span className={styles.fileTexts}>
                <span className={styles.fileName}>{t('dev.frame.resultStart', { size: formatBytes(resultFile.size, language) })}</span>
                <span>{t('dev.frame.resultStartNote')}</span>
              </span>
            </div>
          )}
          {tree && shows === 'tree' && <JsonTree host={host} source={ran} lenient={tree.lenient} />}
          {table && shows === 'table' && <CsvTable host={host} source={table.of === 'input' ? (fileSource ?? ran) : wrote} separator={table.separator} header={table.header} />}
          {extra && shows === 'extra' && extra.view}
          {/* Bytes that are no text are shown as what they are, in place of the editor. */}
          {bytesResult && resultFile && shows === 'result' && <BytesPreview host={host} path={resultFile.path} />}
          <div className={styles.editor} hidden={(tree !== undefined && shows === 'tree') || (table !== undefined && shows === 'table') || (extra !== undefined && shows === 'extra') || (bytesResult && shows === 'result')}>
            {/* Made anew when the tool stops or starts giving a result: what an empty pane says of itself is taken when it is made. */}
            <TextEditor key={`out-${generation}-${tellsOnly}`} ref={output} syntax={outputSyntax} initialText="" wrap={layout.wrap} lineNumbers={layout.lineNumbers} readOnly passKeys={PASSED_KEYS} phrases={phrases} emptyHint={t(tellsOnly ? 'dev.frame.outputNone' : 'dev.frame.outputEmpty')} onFacts={setOutputFacts} />
          </div>
        </section>
        }
      >
        {working && <ToolProgress host={host} title={workTitle} />}
      </SplitPanes>

      <div className={styles.status} role="status">
        <span>{t('dev.frame.notKept')}</span>
        <span className={styles.spring} />
        {said ? (
          <span className={styles.last} data-problem={said.problem === true}>
            {t(said.key, said.values)}
          </span>
        ) : (
          outcome?.ok && (
            <span className={styles.last} data-fine={!outcome.warning} data-problem={outcome.warning === true}>
              {!outcome.warning && <Icon name="circle-check" size={13} />}
              {outcome.fine} · {outcome.summary}
            </span>
          )
        )}
        <button type="button" className={styles.burn} data-tooltip={t('dev.hint.burn')} onClick={burn}>
          <Icon name="trash-can" size={12} />
          {t('dev.frame.burn')}
        </button>
      </div>
    </>
  );
}
