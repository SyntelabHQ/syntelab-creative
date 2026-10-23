import { useTranslation } from '@syntelab/i18n';
import { fromUnit, toUnit, UNIT_NAMES } from './crop-frame';
import type { Unit } from './crop-frame';
import styles from './length-input.module.css';

export interface LengthInputProps {
  /** The length, in points. */
  readonly points: number;
  readonly onChange: (points: number) => void;
  readonly unit: Unit;
  readonly onUnitChange: (unit: Unit) => void;
  /** Already translated: what the length is of. */
  readonly label: string;
  /** The least and the most it may be, in points. */
  readonly min?: number;
  readonly max?: number;
}

/** A length typed as a number, in a unit chosen beside it (millimetres, inches or points). */
export function LengthInput({ points, onChange, unit, onUnitChange, label, min = 0, max = Number.POSITIVE_INFINITY }: LengthInputProps) {
  const t = useTranslation();
  return (
    <span className={styles.length}>
      <input
        type="number"
        className={styles.number}
        min={0}
        step="any"
        aria-label={label}
        value={toUnit(points, unit)}
        onChange={(event) => {
          if (Number.isFinite(event.target.valueAsNumber)) onChange(Math.min(Math.max(fromUnit(event.target.valueAsNumber, unit), min), max));
        }}
      />
      <select className={styles.unit} value={unit} aria-label={t('pdf-organizer.crop.units')} onChange={(event) => onUnitChange(event.target.value as Unit)}>
        {UNIT_NAMES.map((option) => (
          <option key={option} value={option}>
            {t(`pdf-organizer.unit.${option}`)}
          </option>
        ))}
      </select>
    </span>
  );
}
