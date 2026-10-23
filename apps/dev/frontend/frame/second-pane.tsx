import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { editorPhrases, TextEditor } from '@syntelab/text-editor';
import type { Syntax, TextEditorHandle } from '@syntelab/text-editor';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { openFile, problemKey } from '../api/dev-api';
import { formatBytes } from './format';
import type { ToolLayout } from './layout';
import { takeLoad } from './text-tool';
import type { FileToLoad, ToolInput } from './text-tool';
import styles from './tool-frame.module.css';

export interface SecondPaneProps {
  readonly host: Pick<AppHost, 'invoke' | 'pickFiles'>;
  readonly layout: Pick<ToolLayout, 'lineNumbers' | 'wrap'>;
  /** What this text is (a schema), already translated. */
  readonly title: string;
  /** What the empty pane says of itself, already translated. */
  readonly emptyHint: string;
  /** The text is code of this language: the editor colours it. */
  readonly syntax?: Syntax;
  /** The kind of files offered when one is opened. */
  readonly opens: { readonly typeName: string; readonly extensions: readonly string[] };
  /** Told the text a moment after it stops changing; and an empty one when the pane is made (anew). */
  readonly onText?: (text: string) => void;
  /** Told the same, as what a command of the Rust side is given: the text, or a file too large to show, read from where it is. With this, such a file is taken. */
  readonly onSource?: (source: ToolInput) => void;
  /** A file to put into the pane without asking for it: each such object is opened once. */
  readonly load?: FileToLoad;
}

/** How long after the last change the text is told. */
const TOLD_AFTER = 300;
/** Ctrl+Enter runs the tool: the editor leaves it to that command. */
const PASSED_KEYS = ['Mod-Enter'] as const;

/**
 * A second text a tool needs beside what it works on (the schema a document
 * is checked against). It stands under the input, with its own Open, Paste
 * and Clear. Like the input, it is kept nowhere: when the tool is burnt the
 * pane is made anew, empty.
 */
export function SecondPane({ host, layout, title, emptyHint, syntax, opens, onText, onSource, load }: SecondPaneProps) {
  const { t, language } = useI18n();
  /** A file too large to show: it stays on disk, and its start is shown. */
  const [large, setLarge] = useState<{ readonly name: string; readonly size: number; readonly head: string } | null>(null);
  /** What the editor starts with when it is made anew after a large file, and how many times it was. */
  const [fresh, setFresh] = useState({ text: '', made: 0 });
  const editor = useRef<TextEditorHandle>(null);
  const [length, setLength] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const phrases = useMemo(() => editorPhrases(t), [t]);
  const tell = useRef({ onText, onSource, large: large !== null });
  tell.current = { onText, onSource, large: large !== null };
  const told = (text: string) => {
    tell.current.onText?.(text);
    tell.current.onSource?.({ text });
  };

  useEffect(() => {
    told('');
    return () => clearTimeout(timer.current);
  }, []);

  const changed = () => {
    // The start of a large file is only shown: what is told is the file.
    if (tell.current.large) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => told(editor.current?.text() ?? ''), TOLD_AFTER);
  };

  /** The pane holds a text again, after a large file: its editor is made anew with it. */
  const back = (text: string) => {
    clearTimeout(timer.current);
    setLarge(null);
    setFresh((before) => ({ text, made: before.made + 1 }));
    told(text);
  };

  const open = async () => {
    const [path] = await host.pickFiles({ typeName: opens.typeName, extensions: opens.extensions });
    if (path !== undefined) await openAt(path);
  };

  const openAt = async (path: string) => {
    try {
      const opened = await openFile(host, path);
      // A second text is read whole: one too large to show is not what a schema is.
      if (opened.text === undefined) {
        if (!onSource || opened.large !== true || opened.binary === true) return setProblem('dev.problem.failed');
        clearTimeout(timer.current);
        setProblem(null);
        setLarge({ name: opened.name, size: opened.size, head: opened.head ?? '' });
        onSource({ path });
        return;
      }
      setProblem(null);
      if (large !== null) return back(opened.text);
      editor.current?.replace(opened.text);
    } catch (error) {
      setProblem(problemKey(error));
    }
  };

  useEffect(() => {
    if (takeLoad(load)) void openAt(load.path);
  }, [load]);

  return (
    <section className={styles.second} aria-label={title}>
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>{title}</span>
        {problem && (
          <span className={styles.last} data-problem="true">
            {t(problem)}
          </span>
        )}
        <span className={styles.spring} />
        <button type="button" className={styles.action} onClick={() => void open()}>
          <Icon name="folder-open" size={13} />
          {t('dev.frame.openFile')}
        </button>
        <button type="button" className={styles.action} disabled={large !== null} onClick={() => void navigator.clipboard.readText().then((pasted) => pasted !== '' && editor.current?.replace(pasted), () => setProblem('dev.problem.clipboard'))}>
          <Icon name="paste" size={13} />
          {t('dev.frame.paste')}
        </button>
        <button type="button" className={styles.action} disabled={length === 0 && large === null} onClick={() => (large === null ? editor.current?.replace('') : back(''))}>
          <Icon name="eraser" size={13} />
          {t('dev.frame.clear')}
        </button>
      </div>
      {large && (
        <div className={styles.fileNote}>
          <Icon name="file" size={15} />
          <span className={styles.fileTexts}>
            <bdi className={styles.fileName}>{large.name}</bdi>
            <span>{t('dev.frame.largeFile', { size: formatBytes(large.size, language) })}</span>
          </span>
        </div>
      )}
      <div className={styles.editor}>
        <TextEditor key={large ? `large ${large.name} ${large.size}` : `text ${fresh.made}`} ref={editor} syntax={syntax} initialText={large ? large.head : fresh.text} readOnly={large !== null} wrap={layout.wrap} lineNumbers={layout.lineNumbers} passKeys={PASSED_KEYS} phrases={phrases} emptyHint={emptyHint} onFacts={(facts) => setLength(facts.length)} onChange={changed} />
      </div>
    </section>
  );
}
