import { useTranslation } from '@syntelab/i18n';
import { Choice } from '../../frame/choice';
import { oneOf } from '../codec-tool';
import { DeriveTool } from '../derive-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

/** The draft the schema is written for. */
const DRAFTS = ['2020-12', '2019-09', '07', '06', '04'] as const;
const INDENTS = ['2', '4', 'tab'] as const;

/**
 * A JSON Schema written from a sample: the kind of each value, the keys of
 * each object, what arrays hold. The items of an array are taken as samples
 * of one thing: a key some of them lack is not required, kinds that differ
 * are a choice.
 */
export default function JsonSchemaGenerator(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'json-schema-generator.options', (value) => ({ draft: oneOf(DRAFTS, stored(value).draft), indent: oneOf(INDENTS, stored(value).indent) }));

  return (
    <DeriveTool
      {...props}
      what="schema"
      writesJson
      options={{ ...options }}
      optionsView={
        <>
          <Choice label={t('dev.schema.draft')} value={options.draft} options={DRAFTS.map((value) => ({ value, label: value }))} onChange={(draft) => change({ draft })} />
          <Choice label={t('dev.json.indent')} value={options.indent} options={INDENTS.map((value) => ({ value, label: t(`dev.json.indent.${value}`) }))} onChange={(indent) => change({ indent })} />
        </>
      }
      saves={{ typeName: t('dev.json.files'), extension: 'json', name: (name) => `${name?.replace(/\.[^.]+$/, '') ?? 'sample'}.schema.json` }}
      fine={t('dev.schemaGenerator.fine')}
      workTitle={t('dev.schemaGenerator.working')}
    />
  );
}
