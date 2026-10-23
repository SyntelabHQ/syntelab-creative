import { useTranslation } from '@syntelab/i18n';
import { Icon, IconButton } from '@syntelab/ui-kit';
import type { ReactNode } from 'react';
import styles from './settings.module.css';

export interface SettingRowProps {
  /** Already translated. */
  readonly label: string;
  /** A sentence under the label, already translated. */
  readonly hint?: string;
  /** False when the setting was changed: the way back to the default is then offered. */
  readonly isDefault: boolean;
  readonly onRevert: () => void;
  /** The control that changes the setting. */
  readonly children: ReactNode;
  /** The control goes under the label, at full width, instead of beside it. */
  readonly wide?: boolean;
}

/** One setting: its name, its control, and a button that puts it back as it shipped. */
export function SettingRow({ label, hint, isDefault, onRevert, children, wide = false }: SettingRowProps) {
  const t = useTranslation();
  return (
    <div className={styles.row} data-wide={wide}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {hint && <span className={styles.rowHint}>{hint}</span>}
      </div>
      <div className={styles.rowControl}>{children}</div>
      <IconButton
        variant="ghost"
        className={styles.revert}
        aria-label={t('pdf-organizer.settings.revert')}
        tooltipSide="bottom-end"
        disabled={isDefault}
        onClick={onRevert}
      >
        <Icon name="arrow-rotate-left" size={14} />
      </IconButton>
    </div>
  );
}
