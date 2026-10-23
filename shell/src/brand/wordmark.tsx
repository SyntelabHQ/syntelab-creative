import styles from './wordmark.module.css';

/** The product name is never translated (docs/localization/glossary.md). */
const PRODUCT_NAME = 'Syntelab Creative';

const [COMPANY, ...REST] = PRODUCT_NAME.split(' ');

export interface WordmarkProps {
  /** `large` (default) for the first-run screen, `small` for the top of the start screen. */
  readonly size?: 'large' | 'small';
}

/** The "SYNTELAB CREATIVE" wordmark in the brand font; "SYNTELAB" in the brand color. */
export function Wordmark({ size = 'large' }: WordmarkProps) {
  return (
    <h1 className={styles.wordmark} data-size={size} dir="ltr">
      <span className={styles.company}>{COMPANY}</span> {REST.join(' ')}
    </h1>
  );
}
