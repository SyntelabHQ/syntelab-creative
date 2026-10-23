import { useEffect, useState } from 'react';
import styles from './choice.module.css';

export interface NumberBoxProps {
  /** What the number is, already translated: read by screen readers, and shown after the box. */
  readonly label: string;
  /** A whole number from 0 to `most`. */
  readonly value: number;
  readonly most: number;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
}

/**
 * A whole number typed by the user, as an option of a tool (how many spaces
 * a level is pushed in by). What is typed is taken as soon as it is a number
 * within reach; anything else is left in the box, and the last good number
 * stays until it is mended.
 */
export function NumberBox({ label, value, most, disabled, onChange }: NumberBoxProps) {
  const [typed, setTyped] = useState(String(value));
  useEffect(() => setTyped(String(value)), [value]);

  return (
    <label className={styles.choice} data-disabled={disabled === true}>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={most}
        step={1}
        className={styles.number}
        value={typed}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          setTyped(event.target.value);
          const number = Number(event.target.value);
          if (event.target.value.trim() !== '' && Number.isInteger(number) && number >= 0 && number <= most) onChange(number);
        }}
        onBlur={() => setTyped(String(value))}
      />
      <span className={styles.label}>{label}</span>
    </label>
  );
}
