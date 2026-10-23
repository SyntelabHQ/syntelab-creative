import { useTranslation } from '@syntelab/i18n';
import { useCallback, useState } from 'react';
import { Choice } from '../../frame/choice';
import { Toggle } from '../../frame/toggle';
import { CodecTool, oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';
import { markupKindOf } from './markup-kind';

/** What the text is read as: told from how it begins, or said. */
const KINDS = ['auto', 'xml', 'html'] as const;
const MODES = ['format', 'minify', 'validate'] as const;
const INDENTS = ['2', '4', 'tab'] as const;

interface Options {
  readonly kind: (typeof KINDS)[number];
  readonly mode: (typeof MODES)[number];
  readonly indent: (typeof INDENTS)[number];
  readonly dropComments: boolean;
}

const readOptions = (value: unknown): Options => {
  const { kind, mode, indent, dropComments } = stored(value);
  return { kind: oneOf(KINDS, kind), mode: oneOf(MODES, mode), indent: oneOf(INDENTS, indent), dropComments: dropComments === true };
};

/**
 * XML and HTML spread out, put on one line, or only read. XML is read
 * strictly, and what is wrong with it is told with its place; HTML is read
 * as browsers read it, and what `<pre>`, `<script>`, `<style>` and
 * `<textarea>` hold is left as it is. A file of any size goes through.
 */
export default function Markup(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'markup.options', readOptions);
  const { kind, mode } = options;
  const checks = mode === 'validate';
  const mark = mode === 'minify' ? 'min' : 'formatted';
  /** What the last result was told to be, when the kind is not said. */
  const [seen, setSeen] = useState<'html' | 'xml'>('xml');
  const ending = kind === 'auto' ? seen : kind;
  const read = useCallback((text: string | null) => {
    if (text !== null) setSeen(markupKindOf(text));
  }, []);

  return (
    <CodecTool
      {...props}
      tool="markup"
      options={{ ...options }}
      optionsView={
        <>
          <Choice label={t('dev.markup.kind')} value={kind} options={KINDS.map((value) => ({ value, label: t(`dev.markup.kind.${value}`) }))} onChange={(value) => change({ kind: value })} />
          <Choice label={t('dev.json.mode')} value={mode} options={MODES.map((value) => ({ value, label: t(`dev.json.mode.${value}`) }))} onChange={(value) => change({ mode: value })} />
          <Choice label={t('dev.json.indent')} value={options.indent} disabled={mode !== 'format'} options={INDENTS.map((value) => ({ value, label: t(`dev.convert.indent.${value}`) }))} onChange={(indent) => change({ indent })} />
          <Toggle label={t('dev.markup.dropComments')} checked={options.dropComments} disabled={checks} onChange={(dropComments) => change({ dropComments })} />
        </>
      }
      reads
      onText={kind === 'auto' ? read : undefined}
      inputSyntax={kind === 'xml' ? 'xml' : 'html'}
      outputSyntax={kind === 'xml' ? 'xml' : 'html'}
      tellsOnly={checks}
      opens={{ typeName: t('dev.markup.files'), extensions: ['xml', 'html', 'htm', 'xhtml', 'svg', 'xsd', 'xsl', 'xslt', 'rss', 'atom', 'plist', 'config', 'csproj', 'txt'] }}
      saves={{ typeName: t('dev.markup.files'), extension: ending, name: (name) => (name ? name.replace(/(\.[^.]+)?$/, `.${mark}$1`) : `${mark}.${ending}`) }}
      naming={{ beside: { mark }, example: `name.${mark}.${ending}` }}
      fine={t(checks ? 'dev.markup.fine.checked' : 'dev.markup.fine.written')}
      workTitle={t(`dev.markup.working.${mode}`)}
    />
  );
}
