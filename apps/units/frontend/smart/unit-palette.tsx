import { useTranslation } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import type { UnitInfo } from '../engine/units-api';
import styles from './unit-palette.module.css';

export interface UnitPaletteProps {
  /** The units offered, in the order they are listed: pinned ones first. */
  readonly units: readonly UnitInfo[];
  /** The unit that is chosen. */
  readonly chosen: string;
  readonly pins: readonly string[];
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly onChoose: (unit: string) => void;
  readonly onPin: (unit: string) => void;
  readonly nameOf: (unit: UnitInfo) => string;
  readonly colorOf: (unit: UnitInfo) => string | undefined;
  /** What the list is, already translated. */
  readonly label: string;
  /** Lists to choose between, over the search (currencies of countries, cryptocurrencies): each with how many it holds. */
  readonly tabs?: readonly { readonly id: string; readonly label: string; readonly count: number }[];
  readonly tab?: string;
  readonly onTab?: (tab: string) => void;
  /** One unit to a line, its pin first and its symbol at the end: how currencies are listed. */
  readonly rows?: boolean;
}

/**
 * The units one side of the smart converter chooses from: a search over
 * them, then one button for each; the pin beside a unit keeps it first.
 */
export function UnitPalette({ units, chosen, pins, query, onQuery, onChoose, onPin, nameOf, colorOf, label, tabs, tab, onTab, rows = false }: UnitPaletteProps) {
  const t = useTranslation();
  return (
    <div className={styles.palette}>
      {tabs && (
        <div className={styles.tabs} role="tablist">
          {tabs.map((known) => (
            <button key={known.id} type="button" role="tab" aria-selected={known.id === tab} className={styles.tab} onClick={() => onTab?.(known.id)}>
              {known.label}
              <span className={styles.count}>{known.count}</span>
            </button>
          ))}
        </div>
      )}
      <label className={styles.finder}>
        <Icon name="magnifying-glass" size={12} />
        <input type="search" value={query} placeholder={t('units.smart.findUnit')} aria-label={t('units.smart.findUnit')} onChange={(event) => onQuery(event.target.value)} />
      </label>
      <div className={styles.list} role="listbox" aria-label={label} data-rows={rows}>
        {units.length === 0 && <p className={styles.said}>{t('units.smart.noUnitFound')}</p>}
        {units.map((unit) => {
          const pinned = pins.includes(unit.id);
          return (
            <div key={unit.id} className={styles.unit} data-chosen={unit.id === chosen} data-pinned={pinned}>
              <button type="button" role="option" aria-selected={unit.id === chosen} className={styles.choose} onClick={() => onChoose(unit.id)}>
                <span className={styles.symbol} dir="ltr" style={{ color: colorOf(unit) }}>
                  {unit.symbol}
                </span>
                <span className={styles.name}>{nameOf(unit)}</span>
              </button>
              <button type="button" className={styles.pin} aria-pressed={pinned} aria-label={t(pinned ? 'units.smart.unpin' : 'units.smart.pin')} data-tooltip={t(pinned ? 'units.smart.unpin' : 'units.smart.pin')} onClick={() => onPin(unit.id)}>
                <Icon name="bookmark" size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
