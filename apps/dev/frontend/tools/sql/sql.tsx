import { useTranslation } from '@syntelab/i18n';
import { Choice } from '../../frame/choice';
import { CodecTool, oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

const MODES = ['format', 'minify'] as const;
/** How keywords are written: in capitals, in small letters, or as they were. */
const CASES = ['upper', 'lower', 'keep'] as const;
const INDENTS = ['2', '4', 'tab'] as const;

interface Options {
  readonly mode: (typeof MODES)[number];
  readonly case: (typeof CASES)[number];
  readonly indent: (typeof INDENTS)[number];
}

const readOptions = (value: unknown): Options => ({ mode: oneOf(MODES, stored(value).mode), case: oneOf(CASES, stored(value).case), indent: oneOf(INDENTS, stored(value).indent) });

/**
 * SQL written again: each clause on its line, or everything on one line
 * (comments left out). No dialect is asked for: the strings, names and
 * comments of the common ones are all known, and only the space between
 * tokens and the case of keywords change. A dump of any size goes through.
 * What a statement means is not checked.
 */
export default function Sql(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'sql.options', readOptions);
  const { mode } = options;
  const mark = mode === 'minify' ? 'min' : 'formatted';

  return (
    <CodecTool
      {...props}
      tool="sql"
      options={{ ...options }}
      optionsView={
        <>
          <Choice label={t('dev.json.mode')} value={mode} options={MODES.map((value) => ({ value, label: t(`dev.json.mode.${value}`) }))} onChange={(value) => change({ mode: value })} />
          <Choice label={t('dev.sql.case')} value={options.case} options={CASES.map((value) => ({ value, label: t(`dev.sql.case.${value}`) }))} onChange={(value) => change({ case: value })} />
          <Choice label={t('dev.json.indent')} value={options.indent} disabled={mode !== 'format'} options={INDENTS.map((value) => ({ value, label: t(`dev.convert.indent.${value}`) }))} onChange={(indent) => change({ indent })} />
        </>
      }
      reads
      inputSyntax="sql"
      outputSyntax="sql"
      opens={{ typeName: t('dev.sql.files'), extensions: ['sql', 'ddl', 'dml', 'psql', 'txt'] }}
      saves={{ typeName: t('dev.sql.files'), extension: 'sql', name: (name) => (name ? name.replace(/(\.[^.]+)?$/, `.${mark}$1`) : `${mark}.sql`) }}
      naming={{ beside: { mark }, example: `name.${mark}.sql` }}
      fine={t('dev.sql.fine')}
      workTitle={t(`dev.sql.working.${mode}`)}
    />
  );
}
