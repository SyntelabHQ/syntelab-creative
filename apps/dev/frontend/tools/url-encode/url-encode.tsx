import { useTranslation } from '@syntelab/i18n';
import { Choice } from '../../frame/choice';
import { CodecTool, oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

const DIRECTIONS = ['encode', 'decode'] as const;
/** A part of an address, a whole address, or the fields of a form: what each leaves as it is differs. */
const WAYS = ['component', 'address', 'form'] as const;

interface Options {
  readonly direction: (typeof DIRECTIONS)[number];
  readonly way: (typeof WAYS)[number];
}

const readOptions = (value: unknown): Options => ({ direction: oneOf(DIRECTIONS, stored(value).direction), way: oneOf(WAYS, stored(value).way) });

/**
 * Percent-encoding, both ways, in the three ways browsers have: a part of
 * an address, a whole address, a form. A `%` that is followed by no two
 * hexadecimal digits is told with its place.
 */
export default function UrlEncode(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'url-encode.options', readOptions);
  const encoding = options.direction === 'encode';
  const mark = encoding ? 'encoded' : 'decoded';

  return (
    <CodecTool
      {...props}
      tool="url-encode"
      options={{ ...options }}
      optionsView={
        <>
          <Choice label={t('dev.codec.direction')} value={options.direction} options={DIRECTIONS.map((value) => ({ value, label: t(`dev.codec.direction.${value}`) }))} onChange={(direction) => change({ direction })} />
          <Choice label={t('dev.url.way')} value={options.way} options={WAYS.map((value) => ({ value, label: t(`dev.url.way.${value}`) }))} onChange={(way) => change({ way })} />
        </>
      }
      reads={!encoding}
      opens={{ typeName: t('dev.codec.textFiles'), extensions: ['txt', 'url', 'log', 'csv'] }}
      saves={{ typeName: t('dev.codec.textFiles'), extension: 'txt', name: () => `${mark}.txt` }}
      naming={{ beside: { mark }, example: `name.${mark}.txt` }}
      fine={t(encoding ? 'dev.codec.fine.encoded' : 'dev.codec.fine.decoded')}
      workTitle={t(encoding ? 'dev.codec.working.encode' : 'dev.codec.working.decode')}
    />
  );
}
