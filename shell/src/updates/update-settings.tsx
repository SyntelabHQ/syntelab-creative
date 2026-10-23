import { useTranslation } from '@syntelab/i18n';
import { useId } from 'react';
import { preferences, updatePreferences } from '../preferences';
import { useStore } from '../state/create-store';
import styles from './update-settings.module.css';
import { UpdateStatus } from './update-status';

/** Settings: the running version, the check, and whether to check at start. */
export function UpdateSettings() {
  const t = useTranslation();
  const { onlineChecks } = useStore(preferences);
  const noteId = useId();

  return (
    <div className={styles.settings}>
      <UpdateStatus />
      <label className={styles.option}>
        <input
          type="checkbox"
          checked={onlineChecks}
          aria-describedby={noteId}
          onChange={(event) => updatePreferences({ onlineChecks: event.target.checked })}
        />
        {t('shell.update.automatic')}
      </label>
      <p id={noteId} className={styles.note}>
        {t('shell.update.automaticNote')}
      </p>
    </div>
  );
}
