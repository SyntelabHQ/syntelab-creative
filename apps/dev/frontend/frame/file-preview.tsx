import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { editorPhrases, TextEditor } from '@syntelab/text-editor';
import type { Syntax } from '@syntelab/text-editor';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { forgetResult, newResultFile, problemKey } from '../api/dev-api';
import { BytesPreview } from './bytes-preview';
import type { ToolLayout } from './layout';
import { fileRunsByItself, showResult } from './result-file';
import type { ShownResult } from './result-file';
import type { ToolInput, ToolOutcome } from './text-tool';
import styles from './tool-frame.module.css';

export interface FilePreviewProps {
  readonly host: AppHost;
  readonly layout: ToolLayout;
  /** The file whose result is shown, and its size in bytes. */
  readonly path: string;
  readonly size: number;
  /** Runs the tool on one file, as for a text. */
  readonly run: (input: ToolInput) => Promise<ToolOutcome>;
  /** The tool only tells something of the file, or its result is short: nothing is written for it. */
  readonly writesNothing: boolean;
  /** Changes whenever the options do: the file is then run again. */
  readonly optionsKey: string;
  readonly syntax?: Syntax;
}

/** What the run of the file came to; null while it runs. */
interface Shown {
  readonly outcome: ToolOutcome | null;
  readonly result: ShownResult | null;
  /** The file of the program's own the result is in, when it is in one. */
  readonly path: string | null;
  readonly problem: string | null;
  /** Which run it came from: the editor is made anew for each. */
  readonly number: number;
}

/**
 * The result of one file of a run over many, as it would come out: the file
 * is run alone, its result written to a file of the program's own and shown
 * from there (a text, or a preview of bytes). Nothing is written where the
 * results of the run go: that is done by running the tool on the files.
 */
export function FilePreview({ host, layout, path, size, run, writesNothing, optionsKey, syntax }: FilePreviewProps) {
  const { t, language } = useI18n();
  const phrases = useMemo(() => editorPhrases(t), [t]);
  const [shown, setShown] = useState<Shown | null>(null);
  const runs = fileRunsByItself(size);
  const numbers = useRef(0);

  useEffect(() => {
    if (!runs) return;
    let live = true;
    let made: string | null = null;
    const number = ++numbers.current;
    setShown(null);
    void (async () => {
      try {
        if (!writesNothing) made = await newResultFile(host);
        const outcome = await run(made === null ? { path } : { path, out: made });
        const result: ShownResult | null = !outcome.ok ? null : typeof outcome.text === 'string' ? { as: 'text', text: outcome.text, size: outcome.size ?? 0 } : made !== null ? await showResult(host, made).catch(() => null) : null;
        if (live) setShown({ outcome, result, path: result?.as === 'bytes' ? made : null, problem: null, number });
      } catch (error) {
        if (live) setShown({ outcome: null, result: null, path: null, problem: problemKey(error), number });
      }
    })();
    return () => {
      live = false;
      if (made !== null) forgetResult(host, made);
    };
  }, [host.invoke, path, run, writesNothing, optionsKey, runs]);

  const count = (value: number) => new Intl.NumberFormat(language).format(value);
  if (!runs) return <div className={styles.blank}>{t('dev.batch.previewTooLarge')}</div>;
  if (shown === null) return <div className={styles.blank} />;
  const { outcome, result } = shown;

  return (
    <>
      {shown.problem !== null && (
        <div className={styles.wrong} role="alert">
          <Icon name="triangle-exclamation" size={15} />
          <span className={styles.wrongTexts}>
            <span className={styles.wrongMessage}>{t(shown.problem)}</span>
          </span>
        </div>
      )}
      {outcome && !outcome.ok && (
        <div className={styles.wrong} role="alert">
          <Icon name="triangle-exclamation" size={15} />
          <span className={styles.wrongTexts}>
            <span className={styles.wrongMessage}>{outcome.message}</span>
            {outcome.line > 0 && <span>{t('dev.frame.place', { line: count(outcome.line), column: count(outcome.column) })}</span>}
          </span>
        </div>
      )}
      {outcome?.ok && (
        <div className={outcome.warning ? styles.wrong : styles.fine} role="status">
          <Icon name={outcome.warning ? 'triangle-exclamation' : 'circle-check'} size={15} />
          <span className={styles.wrongTexts}>
            <span className={styles.wrongMessage}>{outcome.fine}</span>
            <span>{outcome.summary}</span>
          </span>
        </div>
      )}
      {result?.as === 'bytes'
        ? shown.path !== null && <BytesPreview host={host} path={shown.path} />
        : result !== null &&
          result.text !== '' && (
            <div className={styles.editor}>
              <TextEditor key={shown.number} syntax={syntax} initialText={result.text} wrap={layout.wrap} lineNumbers={layout.lineNumbers} readOnly phrases={phrases} onFacts={() => {}} />
            </div>
          )}
    </>
  );
}
