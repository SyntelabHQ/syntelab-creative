import { useI18n } from '@syntelab/i18n';
import { Icon, MenuButton } from '@syntelab/ui-kit';
import type { MenuSection } from '@syntelab/ui-kit';
import { useCallback } from 'react';
import type { BatchItem, BatchTarget, FoundFile } from '../../frame/batch';
import { Choice } from '../../frame/choice';
import { formatBytes, formatDuration } from '../../frame/format';
import { NumberBox } from '../../frame/number-box';
import type { ToolInput, ToolOutcome } from '../../frame/text-tool';
import { ToolBody } from '../../frame/tool-body';
import frame from '../../frame/tool-frame.module.css';
import type { ToolProps } from '../registry';
import { useOptions } from '../use-options';
import { CHANGES, heldWhole, INDENTS, LINE_ENDINGS, MODES, MOST_SPACES, readOptions, resultMark, resultName, SWITCHES, waysOf } from './json-options';

const OPTIONS_KEY = 'json-formatter.options';

/** What the `json` command of the Rust side answers. */
type JsonAnswer =
  | {
      readonly ok: true;
      readonly text: string | null;
      readonly head: string | null;
      readonly stats: { readonly bytesIn: number; readonly bytesOut: number; readonly values: number; readonly depth: number; readonly objects: number; readonly arrays: number; readonly keys: number; readonly ms: number };
    }
  | { readonly ok: false; readonly error: { readonly code: string; readonly line: number; readonly column: number; readonly offset: number } };

/**
 * The JSON formatter: a text, a file or many files written again indented
 * or on one line, or only checked, with what is wrong and where when it is
 * not JSON. The usual choices stand in the line of options; the rarer ones
 * (how keys, lines and letters are written, lenient reading, what is done
 * to the values) are in the menu beside them.
 *
 * The work is done on the Rust side, which reads the text as it comes: a
 * file is as large as the disk holds. A few choices need the document held
 * whole in memory (sorted keys, short lists on one line, a change of the
 * values): a note says so while one of them is on.
 */
export default function JsonFormatter({ host, layout, onActions }: ToolProps) {
  const { t, language } = useI18n();
  const [options, change] = useOptions(host, OPTIONS_KEY, readOptions);
  const { mode } = options;
  const ways = waysOf(options);
  // The options as one text: what the functions below are made anew for, and what the tool is run again for.
  const waysKey = JSON.stringify(ways);

  const told = useCallback(
    (answer: JsonAnswer, checked: boolean): ToolOutcome => {
      if (!answer.ok) return { ok: false, message: t(`dev.json.problem.${answer.error.code}`), line: answer.error.line, column: answer.error.column, offset: answer.error.offset };
      const { stats } = answer;
      const count = (value: number) => new Intl.NumberFormat(language).format(value);
      const sizes = { size: formatBytes(stats.bytesIn, language), result: formatBytes(stats.bytesOut, language), time: formatDuration(stats.ms, language) };
      const counts = t('dev.json.counts', { values: count(stats.values), objects: count(stats.objects), arrays: count(stats.arrays), keys: count(stats.keys), depth: count(stats.depth) });
      return { ok: true, text: answer.text, head: answer.head, fine: t('dev.json.fine'), summary: t(checked ? 'dev.json.valid' : 'dev.json.done', sizes), notes: [counts] };
    },
    [t, language],
  );

  const run = useCallback(async (input: ToolInput) => told(await host.invoke<JsonAnswer>('json', { ...ways, ...input }), mode === 'validate'), [host.invoke, waysKey, told]);
  /** Only reads what it is given and says whether it is JSON: what a file is told of the moment it is opened or added. */
  const check = useCallback(async (input: ToolInput) => told(await host.invoke<JsonAnswer>('json', { ...ways, mode: 'validate', ...input }), true), [host.invoke, waysKey, told]);
  const checkBatch = useCallback((files: readonly FoundFile[]) => host.invoke<{ items: BatchItem[] }>('json_batch', { ...ways, mode: 'validate', files }).then((answer) => answer.items), [host.invoke, waysKey]);
  const runBatch = useCallback(
    (files: readonly FoundFile[], target: BatchTarget | null, overwrite: boolean) => host.invoke<{ items: BatchItem[] }>('json_batch', { ...ways, files, target, overwrite }).then((answer) => answer.items),
    [host.invoke, waysKey],
  );

  const more: MenuSection[] = [
    { id: 'written', title: t('dev.json.more.written'), items: SWITCHES.map((name) => ({ id: name, label: t(`dev.json.more.${name}`), hint: t(`dev.json.hint.${name}`), kind: 'toggle', checked: options[name], onSelect: () => change({ [name]: !options[name] }) })) },
    { id: 'lines', title: t('dev.json.more.lineEnding'), items: LINE_ENDINGS.map((value) => ({ id: value, label: t(`dev.json.more.lineEnding.${value}`), kind: 'choice', checked: options.lineEnding === value, onSelect: () => change({ lineEnding: value }) })) },
    { id: 'change', title: t('dev.json.more.change'), items: CHANGES.map((value) => ({ id: value, label: t(`dev.json.change.${value}`), kind: 'choice', checked: options.change === value, onSelect: () => change({ change: value }) })) },
  ];

  return (
    <ToolBody
      host={host}
      layout={layout}
      options={
        <>
          <Choice label={t('dev.json.mode')} value={mode} options={MODES.map((value) => ({ value, label: t(`dev.json.mode.${value}`) }))} onChange={(value) => change({ mode: value })} />
          <Choice label={t('dev.json.indent')} value={options.indent} disabled={mode !== 'format'} options={INDENTS.map((value) => ({ value, label: t(`dev.json.indent.${value}`) }))} onChange={(value) => change({ indent: value })} />
          {options.indent === 'custom' && <NumberBox label={t('dev.json.spaces')} value={options.spaces} most={MOST_SPACES} disabled={mode !== 'format'} onChange={(spaces) => change({ spaces })} />}
          <MenuButton label={t('dev.json.more')} sections={more} align="start">
            <Icon name="sliders" size={15} />
          </MenuButton>
          {heldWhole(options) && <span className={frame.optionNote}>{t('dev.json.heldWhole')}</span>}
        </>
      }
      optionsKey={waysKey}
      tellsOnly={mode === 'validate'}
      run={run}
      check={check}
      inputSyntax="json"
      outputSyntax="json"
      tree={{ lenient: options.lenient }}
      opens={{ typeName: t('dev.json.files'), extensions: ['json', 'jsonl', 'jsonc', 'json5', 'geojson', 'map', 'txt'] }}
      saves={{ typeName: t('dev.json.files'), extension: 'json', name: (inputName) => resultName(inputName, mode) }}
      workTitle={t(`dev.json.working.${mode}`)}
      onActions={onActions}
      batch={{ naming: { beside: { mark: resultMark(mode) }, example: `name.${resultMark(mode)}.json` }, run: runBatch, check: checkBatch, wrongText: (code) => t(`dev.json.problem.${code}`) }}
    />
  );
}
