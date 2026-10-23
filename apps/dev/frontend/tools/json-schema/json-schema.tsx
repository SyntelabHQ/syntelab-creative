import { useI18n } from '@syntelab/i18n';
import { useCallback, useState } from 'react';
import type { BatchItem, FoundFile } from '../../frame/batch';
import { Choice } from '../../frame/choice';
import { formatBytes, formatDuration } from '../../frame/format';
import { SecondPane } from '../../frame/second-pane';
import type { ToolInput, ToolOutcome } from '../../frame/text-tool';
import { Toggle } from '../../frame/toggle';
import { ToolBody } from '../../frame/tool-body';
import { oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

/** The draft the schema is read as: told by the schema itself, or one of the five. */
const DRAFTS = ['auto', '2020-12', '2019-09', '07', '06', '04'] as const;
type Draft = (typeof DRAFTS)[number];

interface Options {
  readonly draft: Draft;
  /** What `format` asks for (`email`, `date-time`…) is checked too. */
  readonly formats: boolean;
}

/** What the `schema_check` command of the Rust side answers. */
type SchemaAnswer =
  | { readonly ok: true; readonly misfits: readonly { readonly at: string; readonly rule: string; readonly message: string }[]; readonly stats: { readonly bytesIn: number; readonly ms: number } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly line: number; readonly column: number; readonly offset: number; readonly detail?: string } };

/**
 * A JSON document checked against a JSON Schema (drafts 4 to 2020-12). The
 * document goes in the input, the schema in the pane under it; each place
 * where the document does not fit is listed with the way to it and the rule
 * it breaks. Many files can be checked against the one schema.
 *
 * Nothing is fetched: a schema that points to another by an address is told
 * to be no schema here. What the checker says is in English.
 */
export default function JsonSchema({ host, layout, onActions }: ToolProps) {
  const { t, language } = useI18n();
  const [options, change] = useOptions(host, 'json-schema.options', (value): Options => ({ draft: oneOf(DRAFTS, stored(value).draft), formats: stored(value).formats === true }));
  // Not kept between uses: what is typed into a tool never is.
  const [schema, setSchema] = useState('');
  const { draft, formats } = options;

  /** What is wrong with the schema, or with the document, as the frame is told it. */
  const wrong = useCallback(
    (error: Extract<SchemaAnswer, { ok: false }>['error']): ToolOutcome => {
      const count = (value: number) => new Intl.NumberFormat(language).format(value);
      // What is wrong with the schema has its place in the schema, not in the document: it is said in words.
      if (error.code === 'schema-not-json') return { ok: false, message: t('dev.schema.problem.notJson', { why: t(`dev.json.problem.${error.detail ?? 'expected-value'}`), line: count(error.line), column: count(error.column) }), line: 0, column: 0, offset: 0 };
      if (error.code === 'schema-not-schema') return { ok: false, message: t('dev.schema.problem.notSchema', { detail: error.detail ?? '' }), line: 0, column: 0, offset: 0 };
      return { ok: false, message: t(`dev.json.problem.${error.code}`), line: error.line, column: error.column, offset: error.offset };
    },
    [t, language],
  );

  const run = useCallback(
    async (input: ToolInput): Promise<ToolOutcome> => {
      if (schema.trim() === '') return { ok: false, message: t('dev.schema.problem.none'), line: 0, column: 0, offset: 0 };
      const answer = await host.invoke<SchemaAnswer>('schema_check', { schema, draft, formats, ...('text' in input ? { text: input.text } : { path: input.path }) });
      if (!answer.ok) return wrong(answer.error);
      const found = new Intl.NumberFormat(language).format(answer.misfits.length);
      const summary = `${formatBytes(answer.stats.bytesIn, language)} · ${formatDuration(answer.stats.ms, language)}`;
      if (answer.misfits.length === 0) return { ok: true, text: '', fine: t('dev.schema.fits'), summary };
      const text = answer.misfits.map((misfit) => `${misfit.at === '' ? t('dev.schema.root') : misfit.at}: ${misfit.message}\n    ${t('dev.schema.rule')} ${misfit.rule}`).join('\n');
      return { ok: true, text, fine: t('dev.schema.misfits', { found }), summary, warning: true };
    },
    [host.invoke, schema, draft, formats, wrong, t, language],
  );

  const runBatch = useCallback(
    async (files: readonly FoundFile[]) => {
      const answer = await host.invoke<{ items?: BatchItem[] }>('schema_batch', { schema, draft, formats, files });
      // A schema that cannot be used: every file is told so, since none could be checked.
      return answer.items ?? files.map((file): BatchItem => ({ path: file.path, out: null, status: 'failed', code: 'bad-schema', line: null, column: null, bytesIn: 0, bytesOut: 0, ms: 0 }));
    },
    [host.invoke, schema, draft, formats],
  );

  return (
    <ToolBody
      host={host}
      layout={layout}
      options={
        <>
          <Choice label={t('dev.schema.draft')} value={draft} options={DRAFTS.map((value) => ({ value, label: value === 'auto' ? t('dev.schema.draft.auto') : value }))} onChange={(value) => change({ draft: value })} />
          <Toggle label={t('dev.schema.formats')} checked={formats} onChange={(value) => change({ formats: value })} />
        </>
      }
      optionsKey={`${draft}:${formats}:${schema}`}
      tellsOnly={false}
      run={run}
      inputSyntax="json"
      below={(generation) => <SecondPane key={generation} host={host} layout={layout} syntax="json" title={t('dev.schema.schema')} emptyHint={t('dev.schema.schemaEmpty')} opens={{ typeName: t('dev.json.files'), extensions: ['json', 'schema', 'txt'] }} onText={setSchema} />}
      opens={{ typeName: t('dev.json.files'), extensions: ['json', 'geojson', 'map', 'txt'] }}
      saves={{ typeName: t('dev.codec.textFiles'), extension: 'txt', name: () => 'misfits.txt' }}
      workTitle={t('dev.schema.working')}
      onActions={onActions}
      batch={{ naming: { beside: { mark: 'checked' }, example: '' }, onlyReads: true, run: runBatch, wrongText: (code) => (code === 'not-valid' ? t('dev.schema.notValid') : t(`dev.json.problem.${code}`)) }}
    />
  );
}
