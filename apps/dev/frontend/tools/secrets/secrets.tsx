import { useTranslation } from '@syntelab/i18n';
import { Choice } from '../../frame/choice';
import { GeneratorTool } from '../../frame/generator-tool';
import { NumberBox } from '../../frame/number-box';
import { Toggle } from '../../frame/toggle';
import { oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

/** What is made: a password of chosen letters, or random bytes written in hexadecimal or in Base64. */
const KINDS = ['password', 'words', 'hex', 'base64', 'base64url'] as const;
/** What stands between the words of a passphrase. */
const SEPARATORS = ['-', ' ', '.', '_', ''] as const;

interface Options {
  readonly kind: (typeof KINDS)[number];
  /** The letters of a password; the bytes of the others. */
  readonly length: number;
  readonly count: number;
  readonly small: boolean;
  readonly capital: boolean;
  readonly digits: boolean;
  readonly signs: boolean;
  /** Letters that are taken for one another (0 and O, 1 and l) are left out. */
  readonly noLookAlikes: boolean;
  /** Of a passphrase: how many words, what stands between them, a capital at the start of each, a figure after one. */
  readonly words: number;
  readonly separator: (typeof SEPARATORS)[number];
  readonly capitalWords: boolean;
  readonly digitInWords: boolean;
}

const whole = (value: unknown, otherwise: number) => (typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : otherwise);

const readOptions = (value: unknown): Options => {
  const { kind, length, count, small, capital, digits, signs, noLookAlikes, words, separator, capitalWords, digitInWords } = stored(value);
  return { kind: oneOf(KINDS, kind), length: whole(length, 24), count: whole(count, 1), small: small !== false, capital: capital !== false, digits: digits !== false, signs: signs !== false, noLookAlikes: noLookAlikes === true, words: whole(words, 6), separator: SEPARATORS.includes(separator as Options['separator']) ? (separator as Options['separator']) : '-', capitalWords: capitalWords === true, digitInWords: digitInWords === true };
};

/**
 * Passwords and secrets made from the random bytes of the operating
 * system: passwords of the kinds of letters chosen, each letter as likely
 * as the others, or random bytes as hexadecimal or Base64 (keys, tokens).
 * How much is not known of each to one who knows how it was made is told in
 * bits. Nothing made is kept: it is in the pane until Burn, and nowhere
 * else.
 */
export default function Secrets({ host, layout, onActions }: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(host, 'secrets.options', readOptions);
  const password = options.kind === 'password';
  const words = options.kind === 'words';

  return (
    <GeneratorTool
      host={host}
      layout={layout}
      onActions={onActions}
      tool="secrets"
      request={{ kind: options.kind, length: words ? options.words : options.length, separator: options.separator, capitalWords: options.capitalWords, digitInWords: options.digitInWords, small: options.small, capital: options.capital, digits: options.digits, signs: options.signs, noLookAlikes: options.noLookAlikes }}
      count={options.count}
      bytesEach={(words ? options.words * 10 : password ? options.length : options.length * 2) + 2}
      options={
        <>
          <Choice label={t('dev.secrets.kind')} value={options.kind} options={KINDS.map((value) => ({ value, label: t(`dev.secrets.kind.${value}`) }))} onChange={(kind) => change({ kind })} />
          {words ? (
            <>
              <NumberBox label={t('dev.secrets.words')} value={options.words} most={Number.MAX_SAFE_INTEGER} onChange={(count) => change({ words: Math.max(count, 1) })} />
              <Choice label={t('dev.secrets.separator')} value={options.separator} options={SEPARATORS.map((value) => ({ value, label: value === ' ' ? t('dev.secrets.separator.space') : value === '' ? t('dev.secrets.separator.none') : value }))} onChange={(separator) => change({ separator })} />
              <Toggle label={t('dev.secrets.capitalWords')} checked={options.capitalWords} onChange={(capitalWords) => change({ capitalWords })} />
              <Toggle label={t('dev.secrets.digitInWords')} checked={options.digitInWords} onChange={(digitInWords) => change({ digitInWords })} />
            </>
          ) : (
            <NumberBox label={t(password ? 'dev.secrets.length' : 'dev.secrets.bytes')} value={options.length} most={Number.MAX_SAFE_INTEGER} onChange={(length) => change({ length: Math.max(length, 1) })} />
          )}
          {password && (
            <>
              <Toggle label="a-z" checked={options.small} onChange={(small) => change({ small })} />
              <Toggle label="A-Z" checked={options.capital} onChange={(capital) => change({ capital })} />
              <Toggle label="0-9" checked={options.digits} onChange={(digits) => change({ digits })} />
              <Toggle label="!@#$" checked={options.signs} onChange={(signs) => change({ signs })} />
              <Toggle label={t('dev.secrets.noLookAlikes')} checked={options.noLookAlikes} onChange={(noLookAlikes) => change({ noLookAlikes })} />
            </>
          )}
          <NumberBox label={t('dev.generate.count')} value={options.count} most={Number.MAX_SAFE_INTEGER} onChange={(count) => change({ count: Math.max(count, 1) })} />
        </>
      }
      saves={{ typeName: t('dev.codec.textFiles'), extension: 'txt', name: 'secrets.txt' }}
      fine={t('dev.secrets.fine')}
      noteText={(code, text) => (code === 'secret-bits' ? t('dev.secrets.bits', { bits: text }) : undefined)}
      workTitle={t('dev.secrets.working')}
    />
  );
}
