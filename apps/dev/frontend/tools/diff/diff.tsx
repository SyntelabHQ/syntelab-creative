import { useI18n } from '@syntelab/i18n';
import { useCallback, useContext, useEffect, useState } from 'react';
import { Choice } from '../../frame/choice';
import { DiffSides } from '../../frame/diff-sides';
import { formatBytes, formatDuration } from '../../frame/format';
import { LaunchedFiles } from '../../frame/launched-files';
import { SecondPane } from '../../frame/second-pane';
import type { FileToLoad, ToolInput, ToolOutcome } from '../../frame/text-tool';
import { Toggle } from '../../frame/toggle';
import { ToolBody } from '../../frame/tool-body';
import frame from '../../frame/tool-frame.module.css';
import { oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';
import { FolderDiff } from './folder-diff';

/** What is compared: two texts, line by line; two JSON documents, by what they say; or two folders, file by file. */
const MODES = ['text', 'json', 'folders'] as const;
/** How many lines that are the same are kept around each difference; `all` keeps every line. */
const CONTEXTS = ['3', '10', 'all'] as const;
/** What is written of two JSON documents: a patch as `diff -u` writes it, or a JSON Patch (RFC 6902). */
const RESULTS = ['unified', 'patch'] as const;

interface Options {
  readonly mode: (typeof MODES)[number];
  readonly context: (typeof CONTEXTS)[number];
  readonly result: (typeof RESULTS)[number];
  readonly ignoreCase: boolean;
  readonly ignoreSpaces: boolean;
  readonly ignoreEmptyLines: boolean;
  readonly ignoreNumbers: boolean;
  readonly ignorePunctuation: boolean;
}

const readOptions = (value: unknown): Options => {
  const { mode, context, result, ignoreCase, ignoreSpaces, ignoreEmptyLines, ignoreNumbers, ignorePunctuation } = stored(value);
  return { mode: oneOf(MODES, mode), context: oneOf(CONTEXTS, context), result: oneOf(RESULTS, result), ignoreCase: ignoreCase === true, ignoreSpaces: ignoreSpaces === true, ignoreEmptyLines: ignoreEmptyLines === true, ignoreNumbers: ignoreNumbers === true, ignorePunctuation: ignorePunctuation === true };
};

/** What the `diff` command of the Rust side answers. */
type DiffAnswer =
  | {
      readonly ok: true;
      readonly text?: string;
      readonly head?: string;
      readonly identical: boolean;
      readonly added: number;
      readonly removed: number;
      readonly changed: number;
      readonly same: number;
      /** The number the comparison is held under, and how many rows it has side by side. */
      readonly diff: number;
      readonly shown: number;
      readonly operations: number | null;
      readonly stats: { readonly bytesIn: number; readonly bytesOut: number; readonly ms: number };
    }
  | { readonly ok: false; readonly error: { readonly code: string; readonly line: number; readonly column: number; readonly offset: number; readonly side: 'left' | 'right' } };

const NO_TEXT: ToolInput = { text: '' };

/**
 * Two texts compared line by line, or two JSON documents compared by what
 * they say (the order of keys and how they are spread out is no
 * difference). The first goes in the input, the second in the pane under
 * it. The result is a patch in the unified form, to copy or save, or the
 * two side by side with the words that changed marked; for JSON, also a
 * JSON Patch, each change with the pointer to its place. The two are held
 * whole in memory while they are compared.
 */
export default function Diff({ host, layout, onActions }: ToolProps) {
  const { t, language } = useI18n();
  const [options, change] = useOptions(host, 'diff.options', readOptions);
  // Not kept between uses: what is typed into a tool never is.
  const [other, setOther] = useState<ToolInput>(NO_TEXT);
  const [held, setHeld] = useState<{ readonly diff: number; readonly rows: number } | null>(null);
  /** Two files of a pair chosen among two folders, to be put into the two panes. */
  const [pair, setPair] = useState<{ readonly left: FileToLoad; readonly right: FileToLoad } | null>(null);
  // Files the tool was opened with from outside the program: the first two are its two sides.
  const given = useContext(LaunchedFiles);
  const [launched] = useState<{ readonly left?: FileToLoad; readonly right?: FileToLoad; readonly folders?: { readonly left: string; readonly right: string } }>(() => {
    const [first, second] = given?.files ?? [];
    if (given?.folders) return { folders: { left: first ?? '', right: second ?? '' } };
    return { left: first === undefined ? undefined : { path: first }, right: second === undefined ? undefined : { path: second } };
  });
  useEffect(() => {
    // Two files are not two folders, whatever was compared the last time; and two folders are.
    if (launched.left && options.mode === 'folders') change({ mode: 'text' });
    if (launched.folders && options.mode !== 'folders') change({ mode: 'folders' });
  }, []);
  const { mode, context, result, ignoreCase, ignoreSpaces, ignoreEmptyLines, ignoreNumbers, ignorePunctuation } = options;
  const json = mode === 'json';
  const folders = mode === 'folders';
  // What is passed over, as the Rust side takes it; nothing of it for JSON, which is compared by what it says.
  const ignoring = json ? {} : { ignoreCase, ignoreSpaces, ignoreEmptyLines, ignoreNumbers, ignorePunctuation };
  const ignoringKey = JSON.stringify(ignoring);
  const patch = json && result === 'patch';

  // A comparison the Rust side holds is let go when another takes its place, and when the tool goes away.
  useEffect(() => {
    const number = held?.diff;
    return () => {
      if (number !== undefined) void host.invoke('diff_close', { diff: number }).catch(() => {});
    };
  }, [host.invoke, held?.diff]);

  const run = useCallback(
    async (input: ToolInput): Promise<ToolOutcome> => {
      if ('text' in other && other.text === '') return { ok: false, message: t('dev.diff.problem.none'), line: 0, column: 0, offset: 0 };
      const left = 'path' in input ? { path: input.path } : { text: input.text };
      const answer = await host.invoke<DiffAnswer>('diff', { left, right: other, json, ...ignoring, context: context === 'all' ? 1_000_000 : Number(context), result: patch ? 'patch' : 'unified', out: 'path' in input ? input.out : undefined });
      const count = (value: number) => new Intl.NumberFormat(language).format(value);
      if (!answer.ok) {
        setHeld(null);
        const why = t(`dev.json.problem.${answer.error.code}`);
        // What is wrong with the second text has its place there, not in the input: it is said in words.
        if (answer.error.side === 'right') return { ok: false, message: t('dev.diff.problem.second', { why, line: count(answer.error.line), column: count(answer.error.column) }), line: 0, column: 0, offset: 0 };
        return { ok: false, message: why, line: answer.error.line, column: answer.error.column, offset: answer.error.offset };
      }
      setHeld({ diff: answer.diff, rows: answer.shown });
      const { stats } = answer;
      const notes = answer.identical ? [] : [t('dev.diff.counts', { added: count(answer.added), removed: count(answer.removed), changed: count(answer.changed), same: count(answer.same) })];
      if (answer.operations !== null && !answer.identical) notes.push(t('dev.diff.operations', { count: count(answer.operations) }));
      return { ok: true, text: answer.text, head: answer.head, fine: t(answer.identical ? (json ? 'dev.diff.identicalJson' : 'dev.diff.identical') : 'dev.diff.differs'), summary: `${formatBytes(stats.bytesIn, language)} · ${formatDuration(stats.ms, language)}`, notes };
    },
    [host.invoke, other, json, ignoringKey, context, patch, t, language],
  );

  const modes = <Choice label={t('dev.diff.mode')} value={mode} options={MODES.map((value) => ({ value, label: t(`dev.diff.mode.${value}`) }))} onChange={(value) => change({ mode: value })} />;

  return (
    <>
    <div className={frame.mode} hidden={!folders}>
      <FolderDiff
        host={host}
        lead={modes}
        start={launched.folders}
        onPair={(left, right) => {
          setPair({ left: { path: left }, right: { path: right } });
          change({ mode: 'text' });
        }}
      />
    </div>
    <div className={frame.mode} hidden={folders}>
    {/* The files are put into the two panes here: the frame is not to open the first as a text of its own. */}
    <LaunchedFiles.Provider value={null}>
    <ToolBody
      host={host}
      layout={layout}
      options={
        <>
          {modes}
          <Choice label={t('dev.diff.context')} value={context} options={CONTEXTS.map((value) => ({ value, label: t(`dev.diff.context.${value}`) }))} onChange={(value) => change({ context: value })} />
          {json ? (
            <Choice label={t('dev.diff.result')} value={result} options={RESULTS.map((value) => ({ value, label: t(`dev.diff.result.${value}`) }))} onChange={(value) => change({ result: value })} />
          ) : (
            <>
              <Toggle label={t('dev.diff.ignoreCase')} checked={ignoreCase} onChange={(value) => change({ ignoreCase: value })} />
              <Toggle label={t('dev.diff.ignoreSpaces')} checked={ignoreSpaces} onChange={(value) => change({ ignoreSpaces: value })} />
              <Toggle label={t('dev.diff.ignoreEmptyLines')} checked={ignoreEmptyLines} onChange={(value) => change({ ignoreEmptyLines: value })} />
              <Toggle label={t('dev.diff.ignoreNumbers')} checked={ignoreNumbers} onChange={(value) => change({ ignoreNumbers: value })} />
              <Toggle label={t('dev.diff.ignorePunctuation')} checked={ignorePunctuation} onChange={(value) => change({ ignorePunctuation: value })} />
            </>
          )}
        </>
      }
      optionsKey={`${json}:${context}:${patch}:${ignoringKey}:${'path' in other ? `file ${other.path}` : other.text}`}
      tellsOnly={false}
      run={run}
      inputSyntax={json ? 'json' : undefined}
      outputSyntax={patch ? 'json' : undefined}
      below={(_, burns) => <SecondPane key={burns} host={host} layout={layout} syntax={json ? 'json' : undefined} title={t('dev.diff.second')} emptyHint={t('dev.diff.secondEmpty')} opens={{ typeName: t('dev.codec.anyFile'), extensions: ['*'] }} onSource={setOther} load={pair?.right ?? launched.right} />}
      load={pair?.left ?? launched.left}
      extra={{ label: t('dev.diff.sides'), resultLabel: t(patch ? 'dev.diff.result.patch' : 'dev.diff.result.unified'), first: true, view: <DiffSides host={host} diff={held?.diff ?? null} rows={held?.rows ?? 0} wrap={layout.wrap} /> }}
      opens={{ typeName: t('dev.codec.anyFile'), extensions: ['*'] }}
      saves={patch ? { typeName: t('dev.json.files'), extension: 'json', name: () => 'changes.patch.json' } : { typeName: t('dev.diff.files'), extension: 'diff', name: () => 'changes.diff' }}
      workTitle={t('dev.diff.working')}
      onActions={onActions}
    />
    </LaunchedFiles.Provider>
    </div>
    </>
  );
}
