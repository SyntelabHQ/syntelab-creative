import { useTranslation } from '@syntelab/i18n';
import { Choice } from '../../frame/choice';
import { Toggle } from '../../frame/toggle';
import { CodecTool, oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

const DIRECTIONS = ['encode', 'decode'] as const;
/** How a reference is written: by its name where there is one, or by its number, decimal or hexadecimal. */
const FORMS = ['named', 'decimal', 'hex'] as const;

interface Options {
  readonly direction: (typeof DIRECTIONS)[number];
  /** Letters that are not ASCII are written as references too, not only the five signs HTML reads as its own. */
  readonly beyondAscii: boolean;
  readonly form: (typeof FORMS)[number];
}

const readOptions = (value: unknown): Options => ({ direction: oneOf(DIRECTIONS, stored(value).direction), beyondAscii: stored(value).beyondAscii === true, form: oneOf(FORMS, stored(value).form) });

/**
 * HTML's character references, both ways. Written: the five signs of HTML,
 * or every letter that is not ASCII too, by name or by number. Read back:
 * every name the HTML standard knows and every number; a name that is not
 * known is left as it is and told of.
 */
export default function HtmlEntities(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'html-entities.options', readOptions);
  const encoding = options.direction === 'encode';
  const mark = encoding ? 'encoded' : 'decoded';

  return (
    <CodecTool
      {...props}
      tool="html-entities"
      options={{ ...options }}
      optionsView={
        <>
          <Choice label={t('dev.codec.direction')} value={options.direction} options={DIRECTIONS.map((value) => ({ value, label: t(`dev.codec.direction.${value}`) }))} onChange={(direction) => change({ direction })} />
          <Choice label={t('dev.entities.form')} value={options.form} disabled={!encoding} options={FORMS.map((value) => ({ value, label: t(`dev.entities.form.${value}`) }))} onChange={(form) => change({ form })} />
          <Toggle label={t('dev.entities.beyondAscii')} checked={options.beyondAscii} disabled={!encoding} onChange={(beyondAscii) => change({ beyondAscii })} />
        </>
      }
      reads={!encoding}
      opens={{ typeName: t('dev.entities.files'), extensions: ['html', 'htm', 'xml', 'svg', 'txt'] }}
      saves={{ typeName: t('dev.entities.files'), extension: 'html', name: () => `${mark}.html` }}
      naming={{ beside: { mark }, example: `name.${mark}.html` }}
      fine={t(encoding ? 'dev.codec.fine.encoded' : 'dev.codec.fine.decoded')}
      workTitle={t(encoding ? 'dev.codec.working.encode' : 'dev.codec.working.decode')}
    />
  );
}
