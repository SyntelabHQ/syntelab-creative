import { useI18n } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import { useCallback, useState } from 'react';
import { Choice } from '../../frame/choice';
import { NumberBox } from '../../frame/number-box';
import frame from '../../frame/tool-frame.module.css';
import { oneOf } from '../codec-tool';
import { InspectTool, readIndent } from '../inspect-tool';
import type { Indent } from '../inspect-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';
import { grouped } from './number-text';
import styles from './number-base.module.css';

/** The base the numbers are read in: told from how each is written, one of the usual four, or another. */
const FROMS = ['auto', '2', '8', '10', '16', 'other'] as const;

interface Options {
  readonly from: (typeof FROMS)[number];
  /** The base read in when it is none of the usual ones, and the one more base written in. */
  readonly fromBase: number;
  readonly other: number;
  readonly indent: Indent;
}

const aBase = (value: unknown, otherwise: number) => (typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= 36 ? value : otherwise);
const readOptions = (value: unknown): Options => {
  const { from, fromBase, other, indent } = stored(value);
  return { from: oneOf(FROMS, from), fromBase: aBase(fromBase, 36), other: aBase(other, 36), indent: readIndent(indent) };
};

/** A number as the Rust side tells it. */
interface Told {
  readonly input: string;
  readonly base: number;
  readonly negative: boolean;
  readonly decimal: string;
  readonly hex: string;
  readonly octal: string;
  readonly binary: string;
  readonly other?: { readonly base: number; readonly written: string };
  readonly bits: number;
  /** A negative number as computers keep it, in the smallest usual size that holds it. */
  readonly twosComplement?: { readonly bits: number; readonly hex: string; readonly binary: string };
}

/**
 * Whole numbers of any size, one on each line, told in binary, octal,
 * decimal and hexadecimal, and in one more base of your choosing (up to
 * 36). The base of a number is told from how it is written (0x, 0b, 0o
 * before it; letters mean hexadecimal; decimal otherwise), or chosen. A
 * negative number is given as computers keep it too (two's complement).
 */
export default function NumberBase(props: ToolProps) {
  const { t, language } = useI18n();
  const [options, change] = useOptions(props.host, 'number-base.options', readOptions);
  const [numbers, setNumbers] = useState<readonly Told[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // What the Rust side wrote is JSON: it is read back here, to be laid out.
  const read = useCallback((text: string | null) => {
    try {
      setNumbers(text === null ? null : (JSON.parse(text) as Told[]));
    } catch {
      setNumbers(null);
    }
    setCopied(null);
  }, []);

  const copy = (id: string, text: string) => void navigator.clipboard.writeText(text).then(() => setCopied(id), () => {});
  const row = (id: string, name: string, written: string, each: number) => (
    <div key={id} className={styles.row}>
      <dt>{name}</dt>
      <dd dir="ltr">{grouped(written, each)}</dd>
      <button type="button" className={frame.action} onClick={() => copy(id, written)}>
        <Icon name={copied === id ? 'circle-check' : 'copy'} size={12} />
        {t(copied === id ? 'dev.frame.copied' : 'dev.frame.copy')}
      </button>
    </div>
  );

  return (
    <InspectTool
      {...props}
      tool="number-base"
      options={{ from: options.from === 'auto' ? 'auto' : options.from === 'other' ? String(options.fromBase) : options.from, other: options.other }}
      optionsView={
        <>
          <Choice label={t('dev.bases.from')} value={options.from} options={FROMS.map((value) => ({ value, label: value === 'auto' || value === 'other' ? t(`dev.bases.from.${value}`) : t(`dev.bases.base.${value}`) }))} onChange={(from) => change({ from })} />
          {options.from === 'other' && <NumberBox label={t('dev.bases.fromBase')} value={options.fromBase} most={36} onChange={(fromBase) => change({ fromBase: Math.max(fromBase, 2) })} />}
          <NumberBox label={t('dev.bases.other')} value={options.other} most={36} onChange={(other) => change({ other: Math.max(other, 2) })} />
        </>
      }
      indent={options.indent}
      onIndent={(indent) => change({ indent })}
      onText={read}
      extra={{
        label: t('dev.bases.table'),
        resultLabel: 'JSON',
        first: true,
        view:
          numbers === null || numbers.length === 0 ? (
            <p className={styles.note}>{t('dev.bases.empty')}</p>
          ) : (
            <div className={styles.view}>
              {numbers.map((number, index) => (
                <article key={index} className={styles.number}>
                  <span className={styles.head}>
                    <code dir="ltr">{number.input}</code>
                    <span>{t('dev.bases.readAs', { base: String(number.base), bits: new Intl.NumberFormat(language).format(number.bits) })}</span>
                  </span>
                  <dl className={styles.rows}>
                    {row(`${index}-10`, t('dev.bases.base.10'), number.decimal, 3)}
                    {row(`${index}-16`, t('dev.bases.base.16'), number.hex, 4)}
                    {row(`${index}-2`, t('dev.bases.base.2'), number.binary, 4)}
                    {row(`${index}-8`, t('dev.bases.base.8'), number.octal, 3)}
                    {number.other && row(`${index}-other`, t('dev.bases.baseOf', { base: String(number.other.base) }), number.other.written, 0)}
                    {number.twosComplement && row(`${index}-two-16`, t('dev.bases.twos', { bits: String(number.twosComplement.bits), base: t('dev.bases.base.16') }), number.twosComplement.hex, 4)}
                    {number.twosComplement && row(`${index}-two-2`, t('dev.bases.twos', { bits: String(number.twosComplement.bits), base: t('dev.bases.base.2') }), number.twosComplement.binary, 4)}
                  </dl>
                </article>
              ))}
            </div>
          ),
      }}
      opens={{ typeName: t('dev.codec.textFiles'), extensions: ['txt', 'log', 'csv'] }}
      mark="bases"
      fine={t('dev.bases.fine')}
      workTitle={t('dev.bases.working')}
    />
  );
}
