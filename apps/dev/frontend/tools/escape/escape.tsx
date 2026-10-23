import { useTranslation } from '@syntelab/i18n';
import { Choice } from '../../frame/choice';
import { CodecTool, oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

const DIRECTIONS = ['encode', 'decode'] as const;
/** The language the string is for: each writes its escapes in its own way. */
const FLAVORS = ['json', 'javascript', 'c'] as const;

interface Options {
  readonly direction: (typeof DIRECTIONS)[number];
  readonly flavor: (typeof FLAVORS)[number];
}

const readOptions = (value: unknown): Options => ({ direction: oneOf(DIRECTIONS, stored(value).direction), flavor: oneOf(FLAVORS, stored(value).flavor) });

/**
 * A text written as the inside of a string in code, and read back: for
 * JSON, for JavaScript, for C and the languages that write strings as C
 * does. What is given and what comes out is what stands between the quotes.
 */
export default function Escape(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'escape.options', readOptions);
  const escaping = options.direction === 'encode';
  const mark = escaping ? 'escaped' : 'unescaped';

  return (
    <CodecTool
      {...props}
      tool="escape"
      options={{ ...options }}
      optionsView={
        <>
          <Choice label={t('dev.codec.direction')} value={options.direction} options={DIRECTIONS.map((value) => ({ value, label: t(`dev.escape.direction.${value}`) }))} onChange={(direction) => change({ direction })} />
          <Choice label={t('dev.escape.flavor')} value={options.flavor} options={FLAVORS.map((value) => ({ value, label: t(`dev.escape.flavor.${value}`) }))} onChange={(flavor) => change({ flavor })} />
        </>
      }
      reads={!escaping}
      opens={{ typeName: t('dev.codec.textFiles'), extensions: ['txt', 'json', 'js', 'c', 'log'] }}
      saves={{ typeName: t('dev.codec.textFiles'), extension: 'txt', name: () => `${mark}.txt` }}
      naming={{ beside: { mark }, example: `name.${mark}.txt` }}
      fine={t(escaping ? 'dev.escape.fine.escaped' : 'dev.escape.fine.unescaped')}
      workTitle={t(escaping ? 'dev.escape.working.escape' : 'dev.escape.working.unescape')}
    />
  );
}
