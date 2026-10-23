import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Dialog, Icon } from '@syntelab/ui-kit';
import { useEffect, useId, useState } from 'react';
import { OWN_GROUP, unitName } from '../engine/names';
import { checkOwnUnits } from '../engine/units-api';
import type { ConverterInfo, OwnCheck } from '../engine/units-api';
import { localNumber, marksOf } from '../format/local-number';
import type { Thousands } from '../format/local-number';
import { newOwnId } from './own-units';
import type { OwnUnit } from './own-units';
import styles from './own-unit-dialog.module.css';

export interface OwnUnitDialogProps {
  readonly host: Pick<AppHost, 'invoke'>;
  /** What the user chose to write between thousands. */
  readonly thousands?: Thousands;
  readonly converter: ConverterInfo;
  /** The user's own units of this converter, in their order. */
  readonly all: readonly OwnUnit[];
  /** The unit being changed; null for a new one. */
  readonly editing: OwnUnit | null;
  readonly open: boolean;
  readonly onClose: () => void;
  /** The units of the converter with the new or changed one in its place. */
  readonly onSave: (units: readonly OwnUnit[]) => void;
}

/** How long after the last key what was typed is tried. */
const TRIED_AFTER = 220;

/** A number as it was typed, as the Rust side reads it: a point before the decimals, nothing between thousands. */
const plainNumber = (typed: string, decimal: string): string => {
  const cleaned = typed.replace(/[\s  ']/g, '').replace('−', '-');
  return decimal === ',' ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
};

/**
 * Makes a unit of the user's own, or changes one. It is said by another unit
 * of the converter: the usual way with a factor ("1 pace = 0.75 m"), the
 * advanced way with a formula and its way back. What is typed is tried on
 * the Rust side as it is typed, and what it comes to is shown before it is
 * kept. No formula is ever run as code.
 */
export function OwnUnitDialog({ host, thousands, converter, all, editing, open, onClose, onSave }: OwnUnitDialogProps) {
  const { t, language } = useI18n();
  const id = useId();
  const decimal = marksOf(language).decimal;
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [reference, setReference] = useState(converter.base);
  const [advanced, setAdvanced] = useState(false);
  const [factor, setFactor] = useState('1');
  const [offset, setOffset] = useState('');
  const [toReference, setToReference] = useState('');
  const [fromReference, setFromReference] = useState('');
  const [tried, setTried] = useState<OwnCheck | null>(null);
  /** The id a new unit gets: made when the window opens, and the same until it closes. */
  const [newId, setNewId] = useState('');

  // Opened: the fields are those of the unit being changed, or empty for a new one.
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setSymbol(editing?.symbol ?? '');
    setReference(editing?.reference ?? converter.base);
    setAdvanced(editing?.toReference !== undefined);
    setFactor(editing?.factor?.replace('.', decimal) ?? '1');
    setOffset(editing?.offset?.replace('.', decimal) ?? '');
    setToReference(editing?.toReference ?? '');
    setFromReference(editing?.fromReference ?? '');
    setTried(null);
    setNewId(newOwnId(converter.units.map((unit) => unit.id)));
  }, [open, editing?.id, converter.id]);

  const ownId = editing?.id ?? newId;
  const at = editing ? all.findIndex((unit) => unit.id === editing.id) : all.length;
  /** A unit can be said by the units of the program, and by the user's own that stand before it. */
  const before = all.slice(0, at < 0 ? all.length : at);
  const references = converter.units.filter((unit) => !unit.text && (unit.group !== OWN_GROUP || before.some((own) => own.id === unit.id)));
  const made: OwnUnit = advanced
    ? { id: ownId, name: name.trim(), symbol: symbol.trim(), reference, toReference: toReference.trim(), fromReference: fromReference.trim() }
    : { id: ownId, name: name.trim(), symbol: symbol.trim(), reference, factor: plainNumber(factor, decimal), ...(offset.trim() === '' ? {} : { offset: plainNumber(offset, decimal) }) };
  const units = at < 0 || !editing ? [...all, made] : all.map((unit) => (unit.id === editing.id ? made : unit));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const wait = setTimeout(() => {
      // Named for the try even while its fields are empty: what is tried is how it converts.
      const candidate = units.map((unit) => (unit.id === ownId ? { ...unit, name: unit.name || '-', symbol: unit.symbol || '-' } : unit));
      checkOwnUnits(host, converter.id, candidate).then(
        (answer) => !cancelled && setTried(answer),
        () => !cancelled && setTried(null),
      );
    }, TRIED_AFTER);
    return () => {
      cancelled = true;
      clearTimeout(wait);
    };
  }, [open, ownId, reference, advanced, factor, offset, toReference, fromReference, converter.id]);

  const referenceUnit = converter.units.find((unit) => unit.id === reference);
  const baseUnit = converter.units.find((unit) => unit.id === converter.base);
  const mine = tried?.ok ? tried.units.find((unit) => unit.id === ownId) : undefined;
  const wrongHere = tried && !tried.ok && tried.unit === ownId;
  const complete = name.trim() !== '' && symbol.trim() !== '' && tried?.ok === true;

  return (
    <Dialog open={open} onClose={onClose} title={t(editing ? 'units.own.change' : 'units.own.new')} closeLabel={t('common.action.close')}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (complete) onSave(units);
        }}
      >
        <p className={styles.lead}>{t('units.own.lead', { converter: t(`units.converter.${converter.id}`) })}</p>
        <div className={styles.pair}>
          <label className={styles.field} htmlFor={`${id}-name`}>
            <span>{t('units.own.name')}</span>
            <input id={`${id}-name`} className={styles.input} value={name} maxLength={80} autoFocus placeholder={t('units.own.nameHint')} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className={styles.field} htmlFor={`${id}-symbol`}>
            <span>{t('units.own.symbol')}</span>
            <input id={`${id}-symbol`} className={styles.input} value={symbol} maxLength={20} dir="ltr" placeholder={t('units.own.symbolHint')} onChange={(event) => setSymbol(event.target.value)} />
          </label>
        </div>
        <label className={styles.field} htmlFor={`${id}-reference`}>
          <span>{t('units.own.reference')}</span>
          <select id={`${id}-reference`} className={styles.input} value={reference} onChange={(event) => setReference(event.target.value)}>
            {references.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unitName(t, converter.id, unit)} ({unit.symbol})
              </option>
            ))}
          </select>
        </label>

        <div className={styles.ways} role="tablist" aria-label={t('units.own.way')}>
          <button type="button" role="tab" aria-selected={!advanced} className={styles.way} onClick={() => setAdvanced(false)}>
            {t('units.own.usual')}
          </button>
          <button type="button" role="tab" aria-selected={advanced} className={styles.way} onClick={() => setAdvanced(true)}>
            {t('units.own.advanced')}
          </button>
        </div>

        {advanced ? (
          <>
            <label className={styles.field} htmlFor={`${id}-to`}>
              <span>{t('units.own.toReference', { symbol: symbol.trim() || '?', reference: referenceUnit?.symbol ?? '' })}</span>
              <input id={`${id}-to`} className={styles.input} value={toReference} dir="ltr" spellCheck={false} placeholder="x * 9 / 5 + 32" onChange={(event) => setToReference(event.target.value)} />
            </label>
            <label className={styles.field} htmlFor={`${id}-from`}>
              <span>{t('units.own.fromReference', { symbol: symbol.trim() || '?', reference: referenceUnit?.symbol ?? '' })}</span>
              <input id={`${id}-from`} className={styles.input} value={fromReference} dir="ltr" spellCheck={false} placeholder="(x - 32) * 5 / 9" onChange={(event) => setFromReference(event.target.value)} />
            </label>
            <p className={styles.hint}>{t('units.own.formulaHint')}</p>
          </>
        ) : (
          <>
            <div className={styles.equation} dir="ltr">
              <span className={styles.one}>1 {symbol.trim() || '?'} =</span>
              <input className={styles.input} value={factor} inputMode="decimal" spellCheck={false} aria-label={t('units.own.factor')} onChange={(event) => setFactor(event.target.value)} />
              <span className={styles.one}>{referenceUnit?.symbol}</span>
            </div>
            <label className={styles.field} htmlFor={`${id}-offset`}>
              <span>{t('units.own.offset', { reference: referenceUnit?.symbol ?? '' })}</span>
              <input id={`${id}-offset`} className={styles.input} value={offset} inputMode="decimal" dir="ltr" spellCheck={false} placeholder="0" onChange={(event) => setOffset(event.target.value)} />
            </label>
          </>
        )}

        <div className={styles.said} role="status" data-problem={tried?.ok === false || mine?.undoesItself === false}>
          {tried === null && <span>{t('units.own.trying')}</span>}
          {tried?.ok === false && (
            <>
              <Icon name="triangle-exclamation" size={14} />
              <span>{wrongHere ? t(`units.own.error.${tried.what === 'name' && tried.at !== null ? 'name-unknown' : tried.what}`, { at: (tried.at ?? 0) + 1 }) : t('units.own.error.other')}</span>
            </>
          )}
          {tried?.ok && mine && (
            <>
              <Icon name={mine.undoesItself === false ? 'triangle-exclamation' : 'check'} size={14} />
              <span>
                {mine.one === null ? t('units.own.noValue') : <span dir="ltr">{`1 ${symbol.trim() || '?'} = ${localNumber(mine.one, language, thousands)} ${baseUnit?.symbol ?? ''}`}</span>}
                {mine.undoesItself === false && ` — ${t('units.own.notUndone')}`}
              </span>
            </>
          )}
        </div>

        <div className={styles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={!complete}>
            {t(editing ? 'units.own.keep' : 'units.own.add')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
