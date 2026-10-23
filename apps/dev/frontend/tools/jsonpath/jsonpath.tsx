import { useI18n } from '@syntelab/i18n';
import { useCallback, useState } from 'react';
import { Choice } from '../../frame/choice';
import { formatBytes, formatDuration } from '../../frame/format';
import type { ToolInput, ToolOutcome } from '../../frame/text-tool';
import { TextBox } from '../../frame/toggle';
import { ToolBody } from '../../frame/tool-body';
import { oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

/** What is given of what a query found: the values, the ways to them, or both. */
const SHOWS = ['values', 'ways', 'both'] as const;
type Show = (typeof SHOWS)[number];

/** What the `jsonpath` command of the Rust side answers. */
type PathAnswer =
  | { readonly ok: true; readonly text: string | null; readonly head: string | null; readonly found: number; readonly stats: { readonly bytesIn: number; readonly bytesOut: number; readonly ms: number } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly line: number; readonly column: number; readonly offset: number } };

/**
 * JSONPath (RFC 9535): a query run on a JSON document, with what it finds
 * written as a JSON array. The query is typed in the line of options and is
 * run as it is typed; where it is wrong is told by the place of the letter.
 * The document is held whole in memory while the query runs.
 */
export default function JsonPath({ host, layout, onActions }: ToolProps) {
  const { t, language } = useI18n();
  const [options, change] = useOptions(host, 'jsonpath.options', (value): { readonly show: Show } => ({ show: oneOf(SHOWS, stored(value).show) }));
  // Not kept between uses: what is typed into a tool never is.
  const [query, setQuery] = useState('$');

  const { show } = options;
  const run = useCallback(
    async (input: ToolInput): Promise<ToolOutcome> => {
      const answer = await host.invoke<PathAnswer>('jsonpath', { query, show, indent: '2', ...input });
      if (!answer.ok) {
        // A query that is wrong is told by the place of its letter; a document that is, as the JSON formatter tells it.
        if (answer.error.code === 'bad-query') return { ok: false, message: t('dev.jsonpath.badQuery', { column: String(answer.error.column) }), line: 0, column: 0, offset: 0 };
        return { ok: false, message: t(`dev.json.problem.${answer.error.code}`), line: answer.error.line, column: answer.error.column, offset: answer.error.offset };
      }
      const { stats } = answer;
      const found = new Intl.NumberFormat(language).format(answer.found);
      return { ok: true, text: answer.text, head: answer.head, fine: t('dev.jsonpath.found', { found }), summary: t('dev.json.done', { size: formatBytes(stats.bytesIn, language), result: formatBytes(stats.bytesOut, language), time: formatDuration(stats.ms, language) }), warning: answer.found === 0 };
    },
    [host.invoke, query, show, t, language],
  );

  return (
    <ToolBody
      host={host}
      layout={layout}
      options={
        <>
          <TextBox label={t('dev.jsonpath.query')} value={query} wide code hint="$.store.book[?@.price < 10].title" onChange={setQuery} />
          <Choice label={t('dev.jsonpath.show')} value={show} options={SHOWS.map((value) => ({ value, label: t(`dev.jsonpath.show.${value}`) }))} onChange={(value) => change({ show: value })} />
        </>
      }
      optionsKey={`${show}:${query}`}
      tellsOnly={false}
      run={run}
      inputSyntax="json"
      outputSyntax="json"
      opens={{ typeName: t('dev.json.files'), extensions: ['json', 'geojson', 'map', 'txt'] }}
      saves={{ typeName: t('dev.json.files'), extension: 'json', name: () => 'found.json' }}
      workTitle={t('dev.jsonpath.working')}
      onActions={onActions}
    />
  );
}
