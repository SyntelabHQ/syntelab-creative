import { useTranslation } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import { MOST_DECIMALS } from './columns';
import styles from './column-menu.module.css';

export interface ColumnMenuProps {
  /** The decimals the column is written with now, and those of its unit. */
  readonly decimals: number;
  readonly unitDecimals: number;
  readonly held: 'start' | 'end' | null;
  readonly canMoveStart: boolean;
  readonly canMoveEnd: boolean;
  readonly onMove: (by: -1 | 1) => void;
  /** The precision of this column only; null takes it back to the unit's own. */
  readonly onDecimals: (decimals: number | null) => void;
  /** Makes the precision of this column the precision of its unit, everywhere. Left out where the unit has no decimals to choose. */
  readonly onEverywhere?: () => void;
  readonly onHold: (edge: 'start' | 'end') => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}

/** What can be done with a column: move it, hold it at an edge, change its precision, take it out. */
export function ColumnMenu({ decimals, unitDecimals, held, canMoveStart, canMoveEnd, onMove, onDecimals, onEverywhere, onHold, onRemove, onClose }: ColumnMenuProps) {
  const t = useTranslation();
  const then = (work: () => void) => () => {
    work();
    onClose();
  };
  return (
    <div className={styles.menu}>
      <button type="button" role="menuitem" className={styles.item} disabled={!canMoveStart} onClick={then(() => onMove(-1))}>
        <Icon name="arrow-left" size={13} />
        {t('units.column.moveLeft')}
      </button>
      <button type="button" role="menuitem" className={styles.item} disabled={!canMoveEnd} onClick={then(() => onMove(1))}>
        <Icon name="arrow-right" size={13} />
        {t('units.column.moveRight')}
      </button>
      <div className={styles.rule} />
      <div className={styles.precision}>
        <span className={styles.label} data-tooltip={t('units.column.precisionNote')}>
          <Icon name="sliders" size={13} />
          {t('units.column.precision')}
        </span>
        <div className={styles.stepper}>
          <button type="button" className={styles.step} aria-label={t('units.column.fewer')} disabled={decimals <= 0} onClick={() => onDecimals(decimals - 1)}>
            −
          </button>
          <output className={styles.count} aria-live="polite">
            {decimals}
          </output>
          <button type="button" className={styles.step} aria-label={t('units.column.more')} disabled={decimals >= MOST_DECIMALS} onClick={() => onDecimals(decimals + 1)}>
            +
          </button>
          <button type="button" className={styles.back} aria-label={t('units.column.unitPrecision', { count: unitDecimals })} data-tooltip={t('units.column.unitPrecision', { count: unitDecimals })} disabled={decimals === unitDecimals} onClick={() => onDecimals(null)}>
            <Icon name="rotate-left" size={12} />
          </button>
        </div>
        {onEverywhere && (
          <button type="button" role="menuitem" className={styles.item} disabled={decimals === unitDecimals} data-tooltip={t('units.column.everywhereHint')} onClick={then(onEverywhere)}>
            <Icon name="check-double" size={13} />
            {t('units.column.everywhere')}
          </button>
        )}
      </div>
      <div className={styles.rule} />
      <button type="button" role="menuitemcheckbox" aria-checked={held === 'start'} className={styles.item} onClick={then(() => onHold('start'))}>
        <Icon name="angles-left" size={13} />
        {t(held === 'start' ? 'units.column.unpin' : 'units.column.pinLeft')}
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={held === 'end'} className={styles.item} onClick={then(() => onHold('end'))}>
        <Icon name="angles-right" size={13} />
        {t(held === 'end' ? 'units.column.unpin' : 'units.column.pinRight')}
      </button>
      <div className={styles.rule} />
      <button type="button" role="menuitem" className={styles.item} data-danger="true" onClick={then(onRemove)}>
        <Icon name="xmark" size={13} />
        {t('units.column.remove')}
      </button>
    </div>
  );
}
