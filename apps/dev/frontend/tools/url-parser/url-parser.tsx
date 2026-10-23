import { useTranslation } from '@syntelab/i18n';
import { InspectTool, readIndent } from '../inspect-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

/**
 * URLs taken apart, one on each line: scheme, user, host and what kind of
 * host it is, port, path, each parameter of the query as it is written and
 * as it reads, and the fragment. A URL is read as browsers read it.
 */
export default function UrlParser(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'url-parser.options', (value) => ({ indent: readIndent(stored(value).indent) }));

  return (
    <InspectTool
      {...props}
      tool="url-parser"
      indent={options.indent}
      onIndent={(indent) => change({ indent })}
      opens={{ typeName: t('dev.codec.textFiles'), extensions: ['txt', 'log', 'csv'] }}
      mark="urls"
      fine={t('dev.urlParser.fine')}
      workTitle={t('dev.urlParser.working')}
    />
  );
}
