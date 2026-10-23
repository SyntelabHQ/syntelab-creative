import { useTranslation } from '@syntelab/i18n';
import type { AppSettingsProps } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import { unitName } from '../engine/names';
import { CATEGORIES, listConverters, loadConverter } from '../engine/units-api';
import type { ConverterEntry, ConverterInfo } from '../engine/units-api';
import { MOST_DECIMALS } from '../table/columns';
import { changeSettings, useUnitsSettings } from './units-settings';
import styles from './units-settings-view.module.css';

/** In the place of a converter: the units whose decimals the user changed, of every converter. */
const CHANGED = '';

/** A unit as its row needs it: what it is called, the decimals it has of its own, and those the user chose for it. */
interface Row {
  readonly converter: string;
  readonly unit: string;
  readonly name: string;
  readonly symbol: string;
  /** Null where they are not known: the unit is listed before its converter was read. */
  readonly own: number | null;
  readonly chosen: number | undefined;
}

const plain = (text: string) => text.toLocaleLowerCase();

/**
 * The decimals of each unit, chosen here: a converter is picked, its units
 * are listed (and searched), and each has a stepper. What is chosen stands
 * over the unit's own decimals everywhere the unit is written; it is the
 * same value "Use for this unit everywhere" writes from the menu of a column.
 */
export function PrecisionSetting({ host }: AppSettingsProps) {
  const t = useTranslation();
  const settings = useUnitsSettings(host);
  const [converters, setConverters] = useState<readonly ConverterEntry[]>([]);
  const [chosen, setChosen] = useState(CHANGED);
  const [query, setQuery] = useState('');
  /** The converters read so far, by id: their units, with the decimals of their own. */
  const [read, setRead] = useState<Readonly<Record<string, ConverterInfo>>>({});

  useEffect(() => {
    let cancelled = false;
    void listConverters(host).then((listed) => !cancelled && setConverters(listed), () => {});
    return () => {
      cancelled = true;
    };
  }, [host.invoke]);

  // The converter that is chosen is read, and so are those of the units that were changed: their rows say the unit's own decimals.
  const wanted = chosen === CHANGED ? Object.keys(settings.precision) : [chosen];
  useEffect(() => {
    let cancelled = false;
    for (const id of wanted) {
      if (read[id]) continue;
      void loadConverter(host, id).then((info) => !cancelled && setRead((before) => ({ ...before, [id]: info })), () => {});
    }
    return () => {
      cancelled = true;
    };
  }, [wanted.join(), host.invoke]);

  const setDecimals = (converter: string, unit: string, decimals: number | null) => {
    const { [unit]: _before, ...others } = settings.precision[converter] ?? {};
    const units = decimals === null ? others : { ...others, [unit]: decimals };
    const { [converter]: _old, ...rest } = settings.precision;
    changeSettings(host, { precision: Object.keys(units).length > 0 ? { ...rest, [converter]: units } : rest });
  };

  const rowsOf = (converter: string): Row[] => {
    const info = read[converter];
    const mine = settings.precision[converter] ?? {};
    // Units that write whole numbers their own way (base 16, Roman numerals) have no decimals to choose.
    if (info) return info.units.filter((unit) => !unit.text).map((unit) => ({ converter, unit: unit.id, name: unitName(t, converter, unit), symbol: unit.symbol, own: unit.decimals, chosen: mine[unit.id] }));
    return Object.entries(mine).map(([unit, decimals]) => ({ converter, unit, name: t(`units.unit.${converter}.${unit}`), symbol: '', own: null, chosen: decimals }));
  };
  const sought = plain(query.trim());
  const rows = (chosen === CHANGED ? Object.keys(settings.precision).flatMap((converter) => rowsOf(converter).filter((row) => row.chosen !== undefined)) : rowsOf(chosen)).filter((row) => sought === '' || [row.name, row.symbol, row.unit].some((text) => plain(text).includes(sought)));
  const waiting = chosen !== CHANGED && !read[chosen];

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{t('units.settings.precision')}</h2>
      <p className={styles.note}>{t('units.settings.precisionNote')}</p>
      <div className={styles.filters}>
        <select className={styles.select} value={chosen} aria-label={t('units.settings.precisionConverter')} onChange={(event) => setChosen(event.target.value)}>
          <option value={CHANGED}>{t('units.settings.precisionChanged')}</option>
          {CATEGORIES.map((category) => (
            <optgroup key={category} label={t(`units.menu.${category}`)}>
              {converters
                .filter((known) => known.category === category)
                .map((known) => (
                  <option key={known.id} value={known.id}>
                    {t(`units.converter.${known.id}`)}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <label className={styles.finder}>
          <Icon name="magnifying-glass" size={13} />
          <input type="search" value={query} placeholder={t('units.smart.findUnit')} aria-label={t('units.smart.findUnit')} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      {rows.length === 0 ? (
        <p className={styles.note}>{waiting ? t('units.table.opening') : chosen === CHANGED && sought === '' ? t('units.settings.precisionNoneChanged') : t('units.smart.noUnitFound')}</p>
      ) : (
        <div className={`${styles.rows} ${styles.scrolled}`}>
          {rows.map((row) => {
            const decimals = row.chosen ?? row.own ?? 0;
            return (
              <div key={`${row.converter}.${row.unit}`} className={styles.row} data-changed={row.chosen !== undefined}>
                <span className={styles.rowText}>
                  <span className={styles.rowLabel}>
                    {row.name} {row.symbol !== '' && <span dir="ltr">({row.symbol})</span>}
                  </span>
                  <span className={styles.rowHint}>
                    {chosen === CHANGED && `${t(`units.converter.${row.converter}`)} · `}
                    {row.own !== null && t('units.settings.precisionOwn', { decimals: row.own })}
                  </span>
                </span>
                <span className={styles.stepper}>
                  <button type="button" className={styles.step} aria-label={t('units.column.fewer')} disabled={decimals <= 0} onClick={() => setDecimals(row.converter, row.unit, decimals - 1)}>
                    −
                  </button>
                  <output className={styles.count}>{decimals}</output>
                  <button type="button" className={styles.step} aria-label={t('units.column.more')} disabled={decimals >= MOST_DECIMALS} onClick={() => setDecimals(row.converter, row.unit, decimals + 1)}>
                    +
                  </button>
                  <button type="button" className={styles.remove} aria-label={t('units.settings.precisionBack')} data-tooltip={t('units.settings.precisionBack')} disabled={row.chosen === undefined} onClick={() => setDecimals(row.converter, row.unit, null)}>
                    <Icon name="arrow-rotate-left" size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
