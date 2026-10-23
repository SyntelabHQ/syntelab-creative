import { useTranslation } from '@syntelab/i18n';
import { Choice } from '../../frame/choice';
import { CodecTool, oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

/** `decode` reads YAML and writes JSON; `encode` goes the other way. */
const DIRECTIONS = ['decode', 'encode'] as const;
/** How the JSON is written: pushed in by spaces or a tab, or on one line. */
const JSON_INDENTS = ['2', '4', 'tab', 'min'] as const;
const YAML_INDENTS = ['2', '4'] as const;

interface Options {
  readonly direction: (typeof DIRECTIONS)[number];
  readonly indent: (typeof JSON_INDENTS)[number];
  readonly yamlIndent: (typeof YAML_INDENTS)[number];
}

const readOptions = (value: unknown): Options => ({ direction: oneOf(DIRECTIONS, stored(value).direction), indent: oneOf(JSON_INDENTS, stored(value).indent), yamlIndent: oneOf(YAML_INDENTS, stored(value).yamlIndent) });

/** The name of a file with another ending. */
const renamed = (name: string | null, ending: string, otherwise: string) => `${name?.replace(/\.[^.]+$/, '') ?? otherwise}.${ending}`;

/**
 * YAML written as JSON, and JSON written as YAML. YAML is read by the rules
 * of YAML 1.2 (anchors and merges written out, several documents as an
 * array); what is wrong with it is told with its place. The text is held
 * whole in memory while it is turned.
 */
export default function YamlJson(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'yaml-json.options', readOptions);
  const toJson = options.direction === 'decode';
  const ending = toJson ? 'json' : 'yaml';

  return (
    <CodecTool
      {...props}
      tool="yaml-json"
      options={{ direction: options.direction, indent: options.indent, yamlIndent: Number(options.yamlIndent) }}
      optionsView={
        <>
          <Choice label={t('dev.convert.direction')} value={options.direction} options={DIRECTIONS.map((value) => ({ value, label: t(`dev.yaml.direction.${value}`) }))} onChange={(direction) => change({ direction })} />
          {toJson ? (
            <Choice label={t('dev.json.indent')} value={options.indent} options={JSON_INDENTS.map((value) => ({ value, label: t(`dev.convert.indent.${value}`) }))} onChange={(indent) => change({ indent })} />
          ) : (
            <Choice label={t('dev.json.indent')} value={options.yamlIndent} options={YAML_INDENTS.map((value) => ({ value, label: t(`dev.convert.indent.${value}`) }))} onChange={(yamlIndent) => change({ yamlIndent })} />
          )}
        </>
      }
      reads
      readsJson={!toJson}
      inputSyntax={toJson ? 'yaml' : 'json'}
      outputSyntax={toJson ? 'json' : 'yaml'}
      opens={toJson ? { typeName: t('dev.yaml.files'), extensions: ['yaml', 'yml', 'txt'] } : { typeName: t('dev.json.files'), extensions: ['json', 'txt'] }}
      saves={{ typeName: toJson ? t('dev.json.files') : t('dev.yaml.files'), extension: ending, name: (name) => renamed(name, ending, 'converted') }}
      naming={{ beside: { ending }, inFolder: { ending }, example: `name.${ending}`, noReplace: true }}
      fine={t(toJson ? 'dev.yaml.fine.decode' : 'dev.yaml.fine.encode')}
      workTitle={t('dev.convert.working')}
    />
  );
}
