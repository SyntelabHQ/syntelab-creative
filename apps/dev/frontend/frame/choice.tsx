import styles from './choice.module.css';

export interface ChoiceOption<T extends string> {
  readonly value: T;
  /** Already translated. */
  readonly label: string;
}

export interface ChoiceProps<T extends string> {
  /** What is chosen here, already translated: read by screen readers, and shown before the options. */
  readonly label: string;
  readonly value: T;
  readonly options: readonly ChoiceOption<T>[];
  readonly disabled?: boolean;
  readonly onChange: (value: T) => void;
}

/** One of a few, side by side: an option of a tool (its direction, how far lines are pushed in…). */
export function Choice<T extends string>({ label, value, options, disabled, onChange }: ChoiceProps<T>) {
  return (
    <div className={styles.choice} data-disabled={disabled === true}>
      <span className={styles.label}>{label}</span>
      <div role="radiogroup" aria-label={label} className={styles.options}>
        {options.map((option) => (
          <button key={option.value} type="button" role="radio" aria-checked={option.value === value} disabled={disabled} className={styles.option} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
