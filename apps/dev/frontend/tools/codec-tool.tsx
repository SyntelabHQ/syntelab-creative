import { useI18n } from '@syntelab/i18n';
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import type { BatchItem, BatchTarget, FoundFile, Naming } from '../frame/batch';
import { formatBytes, formatDuration } from '../frame/format';
import type { Syntax } from '@syntelab/text-editor';
import type { ToolInput, ToolOutcome } from '../frame/text-tool';
import { ToolBody } from '../frame/tool-body';
import type { ToolBodyProps } from '../frame/tool-body';
import type { ToolProps } from './registry';

/** What the `codec` command of the Rust side answers. */
type CodecAnswer =
  | {
      readonly ok: true;
      readonly text?: string;
      readonly binary?: boolean;
      readonly head?: string;
      readonly stats: { readonly bytesIn: number; readonly bytesOut: number; readonly ms: number };
      readonly notes: readonly { readonly code: string; readonly text: string }[];
    }
  | { readonly ok: false; readonly error: { readonly code: string; readonly line: number; readonly column: number; readonly offset: number; readonly detail?: string } };

export interface CodecToolProps extends ToolProps {
  /** The tool as the Rust side knows it (its id in the catalog). */
  readonly tool: string;
  /** Its options, as the Rust side takes them. */
  readonly options: Readonly<Record<string, unknown>>;
  /** The options as the user chooses them, drawn in the line over the panes. */
  readonly optionsView: ReactNode;
  /** What is given is read back from a form it was written in: it can be wrong, and is checked the moment it is given. */
  readonly reads: boolean;
  /** What is given is JSON: what is wrong with it is told as the JSON formatter tells it. */
  readonly readsJson?: boolean;
  /** The tool only tells of what it is given (it is read, and nothing is written). */
  readonly tellsOnly?: boolean;
  /** What is given, and what comes out, is code of this language: the editors colour it. */
  readonly inputSyntax?: Syntax;
  readonly outputSyntax?: Syntax;
  /** What is given, or what comes out, is CSV, and can be shown as a table. */
  readonly table?: { readonly of: 'input' | 'result'; readonly separator: string; readonly header: boolean };
  /** A note of the Rust side by this code means all is not well (a digest that does not match): the result is told of as a problem. */
  readonly warnsOn?: string;
  /** The result is short whatever is given (digests): that of a file comes back as a text, and is shown. */
  readonly resultFits?: boolean;
  /** Told the text of each result as it comes (null when there is none, or it went to a file): for a tool that lays it out. */
  readonly onText?: (text: string | null) => void;
  /** One more way of looking at the result, drawn by the tool. */
  readonly extra?: ToolBodyProps['extra'];
  /** Something of the tool's own under the input, and a text it puts into the input. */
  readonly below?: ToolBodyProps['below'];
  readonly put?: ToolBodyProps['put'];
  /** The tool takes any bytes, not only text. */
  readonly takesBytes?: boolean;
  /** The kind of files offered when one is opened; `*` for any. */
  readonly opens: { readonly typeName: string; readonly extensions: readonly string[] };
  /** How a result is saved: its kind, and the name it is offered under. */
  readonly saves: { readonly typeName: string; readonly extension: string; readonly name: (inputName: string | null) => string };
  /** How the results of many files are named. */
  readonly naming: Naming;
  /** That all is well, in a few words, already translated. */
  readonly fine: string;
  /** What the card of long work is titled with, already translated. */
  readonly workTitle: string;
}

/**
 * A tool that turns bytes into other bytes on the Rust side (Base64, URL,
 * HTML entities, escapes, gzip): a text or a file, or many files in one
 * run. A tool gives its options and how its results are named; how it is
 * run, checked and told of is here, once.
 */
export function CodecTool({ host, layout, onActions, tool, options, optionsView, reads, readsJson, tellsOnly, inputSyntax, outputSyntax, table, warnsOn, resultFits, onText, extra, below, put, takesBytes, opens, saves, naming, fine, workTitle }: CodecToolProps) {
  const { t, language } = useI18n();
  // The options as one text: what is run again when it changes, and what the functions below are made anew for.
  const optionsKey = JSON.stringify(options);

  /** What is wrong, in words: by its code, with what a library said of it (in English) where one did. */
  const wrongText = useCallback((code: string, detail?: string) => (code === 'bad-yaml' && !detail ? t('dev.codec.problem.bad-yaml.plain') : t(readsJson && code !== 'not-rows' ? `dev.json.problem.${code}` : `dev.codec.problem.${code}`, { detail: detail ?? '' })), [t, readsJson]);

  /** What the Rust side answered, as the frame is told it. `checking`: nothing was written, the input was only read. */
  const told = useCallback(
    (answer: CodecAnswer, checking: boolean): ToolOutcome => {
      if (!answer.ok) return { ok: false, message: wrongText(answer.error.code, answer.error.detail), line: answer.error.line, column: answer.error.column, offset: answer.error.offset };
      const { stats } = answer;
      const sizes = { size: formatBytes(stats.bytesIn, language), result: formatBytes(stats.bytesOut, language), time: formatDuration(stats.ms, language) };
      // What a stage noted: a code, and a text of its own shape (a count on its first line, then what it counted).
      const notes = answer.notes.map((note) => {
        const [count = '', names = ''] = note.text.split('\n');
        return t(`dev.codec.note.${note.code}`, { count, names });
      });
      return { ok: true, text: answer.text, head: answer.head, binary: answer.binary === true, size: stats.bytesOut, warning: warnsOn !== undefined && answer.notes.some((note) => note.code === warnsOn), fine, summary: t(checking ? 'dev.codec.checked' : 'dev.codec.done', sizes), notes };
    },
    [t, language, fine, wrongText, warnsOn],
  );

  const run = useCallback(
    async (input: ToolInput) => {
      const answer = await host.invoke<CodecAnswer>('codec', { tool, options, ...input, show: resultFits === true });
      onText?.(answer.ok ? (answer.text ?? null) : null);
      return told(answer, false);
    },
    [host.invoke, tool, optionsKey, told, resultFits, onText],
  );
  // Reading a file once more without writing anything: what `codec` does with a path and nowhere to write to.
  const check = useCallback(async (input: ToolInput) => told(await host.invoke<CodecAnswer>('codec', { tool, options, ...input, out: undefined }), true), [host.invoke, tool, optionsKey, told]);

  const runBatch = useCallback(
    (files: readonly FoundFile[], target: BatchTarget | null, overwrite: boolean) => host.invoke<{ items: BatchItem[] }>('codec_batch', { tool, options, files, target, overwrite }).then((answer) => answer.items),
    [host.invoke, tool, optionsKey],
  );
  const checkBatch = useCallback((files: readonly FoundFile[]) => host.invoke<{ items: BatchItem[] }>('codec_batch', { tool, options, files }).then((answer) => answer.items), [host.invoke, tool, optionsKey]);

  return (
    <ToolBody
      host={host}
      layout={layout}
      options={optionsView}
      optionsKey={optionsKey}
      tellsOnly={tellsOnly === true}
      run={run}
      check={reads ? check : undefined}
      takesBytes={takesBytes}
      resultFits={resultFits}
      inputSyntax={inputSyntax}
      outputSyntax={outputSyntax}
      table={table}
      extra={extra}
      below={below}
      put={put}
      opens={opens}
      saves={saves}
      workTitle={workTitle}
      onActions={onActions}
      batch={{ naming, run: runBatch, check: reads ? checkBatch : undefined, wrongText }}
    />
  );
}

/** The name of a file without its last ending, when that ending is the one given; else none. */
export function withoutEnding(name: string | null, ending: string): string | null {
  if (name === null) return null;
  const tail = `.${ending}`;
  return name.length > tail.length && name.toLowerCase().endsWith(tail) ? name.slice(0, -tail.length) : null;
}

/** A choice of a tool as stored, made valid: itself when it is one of those allowed, else the first of them. */
export function oneOf<T extends string>(allowed: readonly T[], stored: unknown): T {
  return allowed.includes(stored as T) ? (stored as T) : (allowed[0] as T);
}
