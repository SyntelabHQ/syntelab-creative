import { useTranslation } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import styles from './drop-hint.module.css';

export interface DropHintProps {
  /** True while files are held over the window. */
  readonly shown: boolean;
  /** Translation key of what will happen to the files. */
  readonly textKey: string;
}

/** Covers the tab while files are held over the window, saying what dropping them does. */
export function DropHint({ shown, textKey }: DropHintProps) {
  const t = useTranslation();
  if (!shown) return null;
  return (
    <div className={styles.hint} role="status">
      <span className={styles.box}>
        <Icon name="layer-group" size={28} />
        {t(textKey)}
      </span>
    </div>
  );
}
