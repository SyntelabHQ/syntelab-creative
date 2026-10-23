import styles from './choice.module.css';

export interface ToggleProps {
  /** What is turned on or off, already translated. */
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}

/** Something that is on or off, as an option of a tool. */
export function Toggle({ label, checked, disabled, onChange }: ToggleProps) {
  return (
    <label className={styles.choice} data-disabled={disabled === true}>
      <input type="checkbox" className={styles.check} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className={styles.label}>{label}</span>
    </label>
  );
}

export interface TextBoxProps {
  /** What is typed here, already translated: shown before the box. */
  readonly label: string;
  readonly value: string;
  /** What is typed is not shown (a secret). */
  readonly hidden?: boolean;
  /** What the empty box says of itself, already translated. */
  readonly hint?: string;
  /** The box is long: what is typed here is a line of some length (a query). */
  readonly wide?: boolean;
  /** What is typed is code: written in the letters code is written in. */
  readonly code?: boolean;
  readonly onChange: (value: string) => void;
}

/** A line of text typed by the user, as an option of a tool. What is typed is the tool's to keep or not: this keeps nothing. */
export function TextBox({ label, value, hidden, hint, wide, code, onChange }: TextBoxProps) {
  return (
    <label className={styles.choice}>
      <span className={styles.label}>{label}</span>
      <input type={hidden ? 'password' : 'text'} className={styles.text} data-wide={wide === true} data-code={code === true} value={value} placeholder={hint} autoComplete="off" spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
