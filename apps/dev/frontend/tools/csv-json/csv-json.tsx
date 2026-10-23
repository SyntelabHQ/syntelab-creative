import { useTranslation } from '@syntelab/i18n';
import { useMemo } from 'react';
import { Choice } from '../../frame/choice';
import { Toggle } from '../../frame/toggle';
import { CodecTool, oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

/** `decode` reads CSV and writes JSON; `encode` goes the other way. */
const DIRECTIONS = ['decode', 'encode'] as const;
/** The sign between the fields. `auto` (told from the first row) is for reading only. */
const SEPARATORS = ['auto', ',', ';', 'tab', '|'] as const;
const INDENTS = ['2', '4', 'tab', 'min'] as const;

interface Options {
  readonly direction: (typeof DIRECTIONS)[number];
  readonly separator: (typeof SEPARATORS)[number];
  /** The first row holds the names of the columns. */
  readonly header: boolean;
  /** Read: numbers, `true` and `false` are written as such, and empty fields as `null`. */
  readonly typed: boolean;
  readonly indent: (typeof INDENTS)[number];
  /** Written: what is nested gets columns of its own (`address.city`). */
  readonly flatten: boolean;
  readonly quoteAll: boolean;
  readonly crlf: boolean;
}

const readOptions = (value: unknown): Options => {
  const { direction, separator, header, typed, indent, flatten, quoteAll, crlf } = stored(value);
  return { direction: oneOf(DIRECTIONS, direction), separator: oneOf(SEPARATORS, separator), header: header !== false, typed: typed !== false, indent: oneOf(INDENTS, indent), flatten: flatten !== false, quoteAll: quoteAll === true, crlf: crlf === true };
};

const renamed = (name: string | null, ending: string, otherwise: string) => `${name?.replace(/\.[^.]+$/, '') ?? otherwise}.${ending}`;

/**
 * CSV written as JSON, and JSON written as CSV. CSV is read a row at a time
 * and each row is written as it is read, so a file of any size goes
 * through; JSON that becomes CSV is held whole, since the names of all the
 * columns must be known before the first row is written.
 */
export default function CsvJson(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'csv-json.options', readOptions);
  const toJson = options.direction === 'decode';
  const ending = toJson ? 'json' : 'csv';
  // A sign must be chosen to write with: where it would be told from the text, a comma is written.
  const separator = !toJson && options.separator === 'auto' ? ',' : options.separator;
  // The table is of the CSV: what is given when it is read, what comes out when it is written.
  const table = useMemo(() => ({ of: toJson ? ('input' as const) : ('result' as const), separator, header: options.header }), [toJson, separator, options.header]);

  return (
    <CodecTool
      {...props}
      tool="csv-json"
      options={toJson ? { direction: 'decode', separator, header: options.header, typed: options.typed, indent: options.indent } : { direction: 'encode', separator, header: options.header, flatten: options.flatten, quoteAll: options.quoteAll, crlf: options.crlf }}
      optionsView={
        <>
          <Choice label={t('dev.convert.direction')} value={options.direction} options={DIRECTIONS.map((value) => ({ value, label: t(`dev.csv.direction.${value}`) }))} onChange={(direction) => change({ direction })} />
          <Choice label={t('dev.csv.separator')} value={separator} options={SEPARATORS.filter((value) => toJson || value !== 'auto').map((value) => ({ value, label: t(`dev.csv.separator.${value}`) }))} onChange={(value) => change({ separator: value })} />
          <Toggle label={t('dev.csv.header')} checked={options.header} onChange={(header) => change({ header })} />
          {toJson ? (
            <>
              <Toggle label={t('dev.csv.typed')} checked={options.typed} onChange={(typed) => change({ typed })} />
              <Choice label={t('dev.json.indent')} value={options.indent} options={INDENTS.map((value) => ({ value, label: t(`dev.convert.indent.${value}`) }))} onChange={(indent) => change({ indent })} />
            </>
          ) : (
            <>
              <Toggle label={t('dev.csv.flatten')} checked={options.flatten} onChange={(flatten) => change({ flatten })} />
              <Toggle label={t('dev.csv.quoteAll')} checked={options.quoteAll} onChange={(quoteAll) => change({ quoteAll })} />
              <Toggle label={t('dev.csv.crlf')} checked={options.crlf} onChange={(crlf) => change({ crlf })} />
            </>
          )}
        </>
      }
      reads
      readsJson={!toJson}
      inputSyntax={toJson ? undefined : 'json'}
      outputSyntax={toJson ? 'json' : undefined}
      table={table}
      opens={toJson ? { typeName: t('dev.csv.files'), extensions: ['csv', 'tsv', 'tab', 'txt'] } : { typeName: t('dev.json.files'), extensions: ['json', 'txt'] }}
      saves={{ typeName: toJson ? t('dev.json.files') : t('dev.csv.files'), extension: ending, name: (name) => renamed(name, ending, 'converted') }}
      naming={{ beside: { ending }, inFolder: { ending }, example: `name.${ending}`, noReplace: true }}
      fine={t(toJson ? 'dev.csv.fine.decode' : 'dev.csv.fine.encode')}
      workTitle={t('dev.convert.working')}
    />
  );
}
