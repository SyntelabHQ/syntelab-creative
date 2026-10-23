import { useTranslation } from '@syntelab/i18n';
import { Choice } from '../../frame/choice';
import { Toggle } from '../../frame/toggle';
import { CodecTool, oneOf, withoutEnding } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

const DIRECTIONS = ['encode', 'decode'] as const;
/** How hard the squeezing tries: quickest, the usual, smallest. */
const LEVELS = ['1', '6', '9'] as const;

interface Options {
  readonly direction: (typeof DIRECTIONS)[number];
  readonly level: (typeof LEVELS)[number];
  /** What is squeezed is written as Base64, so it can be shown and copied as text. */
  readonly asText: boolean;
}

const readOptions = (value: unknown): Options => {
  const { direction, level, asText } = stored(value);
  return { direction: oneOf(DIRECTIONS, direction), level: LEVELS.includes(level as Options['level']) ? (level as Options['level']) : '6', asText: asText !== false };
};

/**
 * Gzip, both ways. What is squeezed is bytes: it is written as Base64 when
 * that is asked for (a text box can hold nothing else), or saved to a file.
 * What is given to be opened may be gzip itself or Base64 of it. A file of
 * any size is worked on from disk.
 */
export default function Gzip(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'gzip.options', readOptions);
  const squeezing = options.direction === 'encode';
  const ending = options.asText ? 'gz.b64' : 'gz';

  return (
    <CodecTool
      {...props}
      tool="gzip"
      options={{ direction: options.direction, level: Number(options.level), asText: options.asText }}
      optionsView={
        <>
          <Choice label={t('dev.codec.direction')} value={options.direction} options={DIRECTIONS.map((value) => ({ value, label: t(`dev.gzip.direction.${value}`) }))} onChange={(direction) => change({ direction })} />
          <Choice label={t('dev.gzip.level')} value={options.level} disabled={!squeezing} options={LEVELS.map((value) => ({ value, label: t(`dev.gzip.level.${value}`) }))} onChange={(level) => change({ level })} />
          <Toggle label={t('dev.gzip.asText')} checked={options.asText} disabled={!squeezing} onChange={(asText) => change({ asText })} />
        </>
      }
      reads={!squeezing}
      takesBytes
      opens={{ typeName: t('dev.codec.anyFile'), extensions: ['*'] }}
      saves={
        squeezing
          ? { typeName: t('dev.gzip.files'), extension: options.asText ? 'b64' : 'gz', name: (name) => `${name ?? 'text'}.${ending}` }
          : { typeName: t('dev.codec.anyFile'), extension: 'txt', name: (name) => withoutEnding(name, 'gz.b64') ?? withoutEnding(name, 'gz') ?? 'opened.txt' }
      }
      naming={squeezing ? { beside: { append: ending }, inFolder: { append: ending }, example: `name.ext.${ending}`, noReplace: true } : { beside: { strip: 'gz', otherwise: 'opened' }, inFolder: { strip: 'gz', otherwise: 'opened' }, example: 'name.ext', noReplace: true }}
      fine={t(squeezing ? 'dev.gzip.fine.squeezed' : 'dev.gzip.fine.opened')}
      workTitle={t(squeezing ? 'dev.gzip.working.squeeze' : 'dev.gzip.working.open')}
    />
  );
}
