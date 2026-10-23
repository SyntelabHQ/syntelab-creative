import { useTranslation } from '@syntelab/i18n';
import { Choice } from '../../frame/choice';
import { NumberBox } from '../../frame/number-box';
import { Toggle } from '../../frame/toggle';
import { CodecTool, oneOf, withoutEnding } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

const DIRECTIONS = ['encode', 'decode'] as const;
const ALPHABETS = ['standard', 'url'] as const;
/** Letters to a line: one line, the two lengths the standards name, or a length of the user's own. */
const WRAPS = ['none', '64', '76', 'custom'] as const;
/** The longest line that can be asked for. */
const WIDEST = 100_000;

interface Options {
  readonly direction: (typeof DIRECTIONS)[number];
  readonly alphabet: (typeof ALPHABETS)[number];
  /** The last group is filled with `=`. */
  readonly padding: boolean;
  readonly wrap: (typeof WRAPS)[number];
  /** Letters to a line when `wrap` is `custom`. */
  readonly width: number;
}

function readOptions(value: unknown): Options {
  const { direction, alphabet, padding, wrap, width } = stored(value);
  return {
    direction: oneOf(DIRECTIONS, direction),
    alphabet: oneOf(ALPHABETS, alphabet),
    padding: padding !== false,
    wrap: oneOf(WRAPS, wrap),
    width: typeof width === 'number' && Number.isInteger(width) && width >= 1 && width <= WIDEST ? width : 80,
  };
}

/**
 * Base64: bytes written as letters, and read back. Either alphabet, with or
 * without the filling, on one line or on lines of a chosen length; what is
 * read back may be written in any of those ways. A file of any kind and any
 * size is worked on from disk.
 */
export default function Base64(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'base64.options', readOptions);
  const encoding = options.direction === 'encode';
  const wrap = options.wrap === 'none' ? 0 : options.wrap === 'custom' ? options.width : Number(options.wrap);

  return (
    <CodecTool
      {...props}
      tool="base64"
      options={{ direction: options.direction, alphabet: options.alphabet, padding: options.padding, wrap }}
      optionsView={
        <>
          <Choice label={t('dev.codec.direction')} value={options.direction} options={DIRECTIONS.map((value) => ({ value, label: t(`dev.codec.direction.${value}`) }))} onChange={(direction) => change({ direction })} />
          <Choice label={t('dev.base64.alphabet')} value={options.alphabet} disabled={!encoding} options={ALPHABETS.map((value) => ({ value, label: t(`dev.base64.alphabet.${value}`) }))} onChange={(alphabet) => change({ alphabet })} />
          <Toggle label={t('dev.base64.padding')} checked={options.padding} disabled={!encoding} onChange={(padding) => change({ padding })} />
          <Choice label={t('dev.base64.wrap')} value={options.wrap} disabled={!encoding} options={WRAPS.map((value) => ({ value, label: t(`dev.base64.wrap.${value}`) }))} onChange={(value) => change({ wrap: value })} />
          {options.wrap === 'custom' && <NumberBox label={t('dev.base64.width')} value={options.width} most={WIDEST} disabled={!encoding} onChange={(width) => width > 0 && change({ width })} />}
        </>
      }
      reads={!encoding}
      takesBytes
      opens={{ typeName: t('dev.codec.anyFile'), extensions: ['*'] }}
      saves={
        encoding
          ? { typeName: t('dev.base64.files'), extension: 'b64', name: (name) => `${name ?? 'encoded'}.b64` }
          : { typeName: t('dev.codec.anyFile'), extension: 'bin', name: (name) => withoutEnding(name, 'b64') ?? 'decoded.bin' }
      }
      naming={encoding ? { beside: { append: 'b64' }, inFolder: { append: 'b64' }, example: 'name.ext.b64', noReplace: true } : { beside: { strip: 'b64', otherwise: 'decoded' }, inFolder: { strip: 'b64', otherwise: 'decoded' }, example: 'name.ext', noReplace: true }}
      fine={t(encoding ? 'dev.codec.fine.encoded' : 'dev.codec.fine.decoded')}
      workTitle={t(encoding ? 'dev.codec.working.encode' : 'dev.codec.working.decode')}
    />
  );
}
