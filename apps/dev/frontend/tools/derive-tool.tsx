import { useI18n } from '@syntelab/i18n';
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { formatBytes, formatDuration } from '../frame/format';
import type { ToolInput, ToolOutcome } from '../frame/text-tool';
import { ToolBody } from '../frame/tool-body';
import type { ToolProps } from './registry';

/** What the `derive` command of the Rust side answers. */
type DeriveAnswer =
  | { readonly ok: true; readonly text: string | null; readonly head: string | null; readonly stats: { readonly bytesIn: number; readonly bytesOut: number; readonly ms: number } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly line: number; readonly column: number; readonly offset: number } };

export interface DeriveToolProps extends ToolProps {
  /** What is written from the sample, as the Rust side names it: `schema` or `typescript`. */
  readonly what: string;
  /** How it is written, as the Rust side takes it. */
  readonly options: Readonly<Record<string, unknown>>;
  readonly optionsView: ReactNode;
  /** How the result is saved: its kind, its ending and its name. */
  readonly saves: { readonly typeName: string; readonly extension: string; readonly name: (inputName: string | null) => string };
  /** What is written is JSON too (a schema): the result is coloured as the sample is. */
  readonly writesJson?: boolean;
  /** That it was written, in a few words, already translated. */
  readonly fine: string;
  readonly workTitle: string;
}

/**
 * A tool that writes something from a sample of JSON (a schema the sample
 * fits, declarations of its type). The sample is held whole in memory while
 * its shape is told.
 */
export function DeriveTool({ host, layout, onActions, what, options, optionsView, saves, writesJson, fine, workTitle }: DeriveToolProps) {
  const { t, language } = useI18n();
  const optionsKey = JSON.stringify(options);

  const run = useCallback(
    async (input: ToolInput): Promise<ToolOutcome> => {
      const answer = await host.invoke<DeriveAnswer>('derive', { what, ...options, ...input });
      if (!answer.ok) return { ok: false, message: t(`dev.json.problem.${answer.error.code}`), line: answer.error.line, column: answer.error.column, offset: answer.error.offset };
      const { stats } = answer;
      return { ok: true, text: answer.text, head: answer.head, fine, summary: t('dev.json.done', { size: formatBytes(stats.bytesIn, language), result: formatBytes(stats.bytesOut, language), time: formatDuration(stats.ms, language) }) };
    },
    [host.invoke, what, optionsKey, fine, t, language],
  );

  return (
    <ToolBody
      host={host}
      layout={layout}
      options={optionsView}
      optionsKey={optionsKey}
      tellsOnly={false}
      run={run}
      inputSyntax="json"
      outputSyntax={writesJson ? 'json' : undefined}
      opens={{ typeName: t('dev.json.files'), extensions: ['json', 'geojson', 'map', 'txt'] }}
      saves={saves}
      workTitle={workTitle}
      onActions={onActions}
    />
  );
}
