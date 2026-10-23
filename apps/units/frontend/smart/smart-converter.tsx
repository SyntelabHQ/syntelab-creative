import { useI18n } from '@syntelab/i18n';
import { AppInvokeError } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useEffect, useRef, useState } from 'react';
import { converterIcon } from '../engine/converter-icons';
import { OWN_GROUP, unitName } from '../engine/names';
import { convert, loadConverter } from '../engine/units-api';
import type { ConverterEntry, ConverterInfo, UnitInfo } from '../engine/units-api';
import { copiedNumber, localNumber, marksOf } from '../format/local-number';
import { useOwnUnitsVersion } from '../own/own-units';
import { pinsOf, savePins } from '../pins/pins-store';
import { RatesLine } from '../rates/rates-line';
import { CURRENCY, useRates } from '../rates/rates-store';
import { plain } from '../search/plain';
import { useUnitsSettings } from '../settings/units-settings';
import styles from './smart-converter.module.css';
import { inSmartTabOrder } from './currency-order';
import { SMART_TAB_UNITS } from './smart-tab-units';
import { UnitPalette } from './unit-palette';

export interface SmartConverterProps {
  readonly host: Pick<AppHost, 'invoke' | 'loadData' | 'saveData' | 'openSettings' | 'openLink' | 'active'>;
  /** The converters it has a tab for. */
  readonly converters: readonly ConverterEntry[];
  /** Converters that are listed and not built yet: their tabs are drawn, and wait. */
  readonly coming: readonly ConverterEntry[];
  readonly converterId: string;
  readonly onConverter: (id: string) => void;
  /** Opens the table of a converter. */
  readonly onOpenTable: (id: string) => void;
}

/** The two lists of currencies: those of countries, and cryptocurrencies. */
type Kind = 'fiat' | 'crypto';
const KINDS: readonly Kind[] = ['fiat', 'crypto'];

/** What was typed and chosen for each converter, so going to another and back finds it. */
interface Typed {
  readonly value: string;
  readonly from: string;
  readonly to: string;
}

const DATA_KEY = 'smartTab';
/** How long after the last key the value is converted. */
const CONVERT_AFTER = 120;
/** How long "Copied" is said. */
const COPIED_FOR = 1400;

type Answer = { readonly kind: 'converted'; readonly text: string; readonly ambiguous: boolean } | { readonly kind: 'empty' } | { readonly kind: 'problem'; readonly key: string } | null;

/**
 * The first page of Units: one value, from a unit to another. Each side has
 * the popular units of the converter to choose from, with a search; pinned
 * units come first; the two sides change places with one button. The same
 * engine and the same precision as the table.
 */
export function SmartConverter({ host, converters, coming, converterId, onConverter, onOpenTable }: SmartConverterProps) {
  const { t, language } = useI18n();
  const { extremes, precision, between } = useUnitsSettings(host);
  /** The decimals the user chose for units of this converter. */
  const decimals = precision[converterId];
  const [converter, setConverter] = useState<ConverterInfo | null>(null);
  const [typed, setTyped] = useState<Readonly<Record<string, Typed>>>(() => {
    const stored = host.loadData<unknown>(DATA_KEY);
    return typeof stored === 'object' && stored !== null ? (stored as Record<string, Typed>) : {};
  });
  const [pins, setPins] = useState<readonly string[]>([]);
  const [answer, setAnswer] = useState<Answer>(null);
  const [queries, setQueries] = useState({ from: '', to: '' });
  /** For currencies: which of the two lists each side shows; null follows the unit that is chosen. */
  const [kinds, setKinds] = useState<{ readonly from: Kind | null; readonly to: Kind | null }>({ from: null, to: null });
  const [copied, setCopied] = useState(false);
  /** The user's own units changed: the converter is read again. */
  const ownVersion = useOwnUnitsVersion();
  const tabs = useRef<HTMLDivElement>(null);
  /** New rates of currencies change what a value comes to. */
  const rates = useRates();

  useEffect(() => {
    let cancelled = false;
    setConverter(null);
    setAnswer(null);
    setQueries({ from: '', to: '' });
    setKinds({ from: null, to: null });
    void loadConverter(host, converterId).then(
      (loaded) => {
        if (cancelled) return;
        setConverter(loaded);
        setPins(pinsOf(host, loaded));
      },
      () => !cancelled && setAnswer({ kind: 'problem', key: 'units.smart.failed' }),
    );
    return () => {
      cancelled = true;
    };
  }, [converterId, host.invoke, ownVersion]);

  // The wheel turns the tabs sideways when they do not all fit.
  useEffect(() => {
    const element = tabs.current;
    if (!element) return;
    const turn = (event: WheelEvent) => {
      if (element.scrollWidth <= element.clientWidth || event.deltaY === 0) return;
      event.preventDefault();
      element.scrollLeft += event.deltaY;
    };
    element.addEventListener('wheel', turn, { passive: false });
    return () => element.removeEventListener('wheel', turn);
  }, []);

  const known = (id: string | undefined) => (id !== undefined && converter?.units.some((unit) => unit.id === id) ? id : undefined);
  const now = typed[converterId];
  const value = now?.value ?? '';
  // The two units: those chosen, else the first two the converter starts with.
  const from = converter ? (known(now?.from) ?? converter.startsWith[0] ?? converter.base) : '';
  const to = converter ? (known(now?.to) ?? converter.startsWith.find((id) => id !== from) ?? converter.units.find((unit) => unit.id !== from)?.id ?? from) : '';

  const change = (next: Partial<Typed>) => {
    const all = { ...typed, [converterId]: { value, from, to, ...next } };
    setTyped(all);
    host.saveData(DATA_KEY, all);
  };

  // The value is converted a moment after the last key.
  useEffect(() => {
    if (!converter || from === '' || to === '') return;
    let cancelled = false;
    const wait = setTimeout(() => {
      convert(host, { converter: converter.id, from, value, to: [to], decimals, extremes, decimalMark: marksOf(language).decimal }).then(
        (converted) => !cancelled && setAnswer(converted.empty ? { kind: 'empty' } : { kind: 'converted', text: converted.results[0]?.text ?? '', ambiguous: converted.ambiguous === true }),
        (error: unknown) => !cancelled && setAnswer({ kind: 'problem', key: error instanceof AppInvokeError && error.code === 'not-a-number' ? 'units.smart.notANumber' : 'units.smart.failed' }),
      );
    }, CONVERT_AFTER);
    return () => {
      cancelled = true;
      clearTimeout(wait);
    };
  }, [converter, from, to, value, decimals, extremes, language, host.invoke, rates.version]);

  const togglePin = (id: string) => {
    const next = pins.includes(id) ? pins.filter((pinned) => pinned !== id) : [...pins, id];
    setPins(next);
    savePins(host, converterId, next);
  };

  const unitById = (id: string) => converter?.units.find((unit) => unit.id === id);
  const nameOf = (unit: UnitInfo) => unitName(t, converterId, unit);
  const colorOf = (unit: UnitInfo) => converter?.groups.find((group) => group.id === unit.group)?.color;
  const [fromUnit, toUnit] = [unitById(from), unitById(to)];
  const result = answer?.kind === 'converted' ? answer.text : '';
  const shownResult = result === '' ? '' : toUnit?.text ? result : localNumber(result, language, between);

  // What each side lists: the units of the model's smart tab, the user's own, the pinned, and the one chosen.
  // Currencies are all listed, those of countries and cryptocurrencies apart: there is no telling which one is wanted.
  // Pinned first, in the order they were pinned; then as the converter lists them.
  const isCurrency = converterId === CURRENCY;
  const kindOf = (unit: UnitInfo | undefined): Kind => (unit?.currency === 'crypto' ? 'crypto' : 'fiat');
  const shownKind = (which: 'from' | 'to'): Kind => kinds[which] ?? kindOf(unitById(which === 'from' ? from : to));
  const listed = (which: 'from' | 'to', chosen: string, query: string): UnitInfo[] => {
    const wanted = plain(query.trim());
    const units = converter?.units ?? [];
    // The units of the model's smart tab, in its order; where it names none, the popular ones. Then the user's own,
    // and whatever else is pinned or chosen.
    const named = (SMART_TAB_UNITS[converterId] ?? []).flatMap((id) => units.find((unit) => unit.id === id) ?? []);
    const usual = named.length > 0 ? named : units.filter((unit) => unit.popular);
    const offered = isCurrency
      ? inSmartTabOrder(units).filter((unit) => kindOf(unit) === shownKind(which))
      : [...usual, ...units.filter((unit) => !usual.includes(unit) && (unit.group === OWN_GROUP || pins.includes(unit.id) || unit.id === chosen))];
    const found = offered.filter((unit) => wanted === '' || [nameOf(unit), unit.symbol, unit.id, ...unit.aliases].some((name) => plain(name).includes(wanted)));
    return [...pins.flatMap((id) => found.find((unit) => unit.id === id) ?? []), ...found.filter((unit) => !pins.includes(unit.id))];
  };
  const count = (kind: Kind) => (converter?.units ?? []).filter((unit) => kindOf(unit) === kind).length;

  const copy = () => {
    if (result === '') return;
    void navigator.clipboard?.writeText(toUnit?.text ? result : copiedNumber(result, language)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FOR);
    });
  };

  const side = (which: 'from' | 'to', unit: UnitInfo | undefined) => (
    <UnitPalette
      units={listed(which, which === 'from' ? from : to, queries[which])}
      tabs={isCurrency ? KINDS.map((kind) => ({ id: kind, label: t(`units.smart.${kind}`), count: count(kind) })) : undefined}
      tab={shownKind(which)}
      onTab={(kind) => setKinds({ ...kinds, [which]: kind as Kind })}
      rows={isCurrency}
      chosen={which === 'from' ? from : to}
      pins={pins}
      query={queries[which]}
      onQuery={(query) => setQueries({ ...queries, [which]: query })}
      onChoose={(id) => change(which === 'from' ? { from: id } : { to: id })}
      onPin={togglePin}
      nameOf={nameOf}
      colorOf={colorOf}
      label={t(which === 'from' ? 'units.smart.fromUnits' : 'units.smart.toUnits', { unit: unit ? nameOf(unit) : '' })}
    />
  );

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>{t('units.smart.title')}</h1>

        <div ref={tabs} className={styles.tabs} role="tablist" aria-label={t('units.smart.converters')}>
          {converters.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={entry.id === converterId} className={styles.tab} onClick={() => onConverter(entry.id)}>
              <Icon name={converterIcon(entry.icon)} size={15} />
              {t(`units.converter.${entry.id}`)}
            </button>
          ))}
          {coming.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={false} className={styles.tab} disabled data-tooltip={t('units.hint.comingSoon')}>
              <Icon name={converterIcon(entry.icon)} size={15} />
              {t(`units.converter.${entry.id}`)}
            </button>
          ))}
        </div>

        {converter && (
          <>
            <div className={styles.work}>
              <section className={styles.side}>
                <label className={styles.label} htmlFor="units-smart-value">
                  {t('units.smart.fromLabel')}{' '}
                  {fromUnit && (
                    <strong>
                      {nameOf(fromUnit)} <span dir="ltr">({fromUnit.symbol})</span>
                    </strong>
                  )}
                </label>
                <div className={styles.box}>
                  <input id="units-smart-value" className={styles.value} type="text" inputMode={fromUnit?.text ? 'text' : 'decimal'} dir="ltr" autoFocus spellCheck={false} value={value} placeholder={t('units.smart.valueHint')} onChange={(event) => change({ value: event.target.value })} />
                  {value !== '' && (
                    <button type="button" className={styles.inBox} aria-label={t('units.smart.clear')} data-tooltip={t('units.smart.clear')} onClick={() => change({ value: '' })}>
                      <Icon name="xmark" size={13} />
                    </button>
                  )}
                </div>
                {side('from', fromUnit)}
              </section>

              <button type="button" className={styles.swap} aria-label={t('units.smart.swap')} data-tooltip={t('units.smart.swap')} onClick={() => change({ from: to, to: from })}>
                <Icon name="right-left" size={15} />
              </button>

              <section className={styles.side}>
                <span className={styles.label}>
                  {t('units.smart.toLabel')}{' '}
                  {toUnit && (
                    <strong>
                      {nameOf(toUnit)} <span dir="ltr">({toUnit.symbol})</span>
                    </strong>
                  )}
                </span>
                <div className={styles.box} data-result="true">
                  <output className={styles.value} dir="ltr" aria-live="polite" data-empty={shownResult === ''}>
                    {shownResult === '' ? t(answer?.kind === 'problem' ? 'units.smart.noResult' : 'units.smart.nothingTyped') : shownResult}
                  </output>
                  {result !== '' && (
                    <button type="button" className={styles.inBox} aria-label={t(copied ? 'units.smart.copied' : 'units.smart.copy')} data-tooltip={t(copied ? 'units.smart.copied' : 'units.smart.copy')} onClick={copy}>
                      <Icon name={copied ? 'check' : 'copy'} size={13} />
                    </button>
                  )}
                </div>
                {side('to', toUnit)}
              </section>
            </div>

            {answer?.kind === 'problem' && (
              <p className={styles.problem} role="alert">
                {t(answer.key)}
              </p>
            )}
            {answer?.kind === 'converted' && answer.ambiguous && (
              <p className={styles.note} role="status">
                <Icon name="circle-info" size={14} />
                <span>{t('units.smart.ambiguous', { mark: marksOf(language).decimal })}</span>
              </p>
            )}

            {converterId === CURRENCY && (
              <div className={styles.rates}>
                <RatesLine host={host} />
              </div>
            )}

            <div className={styles.foot}>
              <Button onClick={() => onOpenTable(converterId)}>
                <Icon name="table-cells" size={14} />
                {t('units.smart.openTable')}
              </Button>
              {!isCurrency && <span className={styles.footNote}>{t('units.smart.popularNote', { count: converter.units.length })}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
