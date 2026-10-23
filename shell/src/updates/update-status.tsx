import { useTranslation } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import { APP_VERSION, checkForUpdates, openUpdateDialog, useUpdateState } from './update-store';
import styles from './update-status.module.css';

/**
 * One line: the version that is running, whether it is the newest, and a way
 * to check now. Shown at the bottom of Start and in Settings.
 */
export function UpdateStatus() {
  const t = useTranslation();
  const state = useUpdateState();

  return (
    <p className={styles.status}>
      <span className={styles.version}>{t('shell.update.version', { version: APP_VERSION })}</span>

      <span className={styles.message} data-status={state.status} role="status">
        {state.status === 'checking' && t('shell.update.checking')}
        {state.status === 'current' && (
          <>
            <Icon name="circle-check" size={14} />
            {t('shell.update.current')}
          </>
        )}
        {state.status === 'failed' && t('shell.update.failed')}
        {state.status === 'available' && (
          <button type="button" className={styles.available} onClick={openUpdateDialog}>
            <Icon name="circle-arrow-up" size={14} />
            {t('shell.update.available', { version: state.info.latest })}
          </button>
        )}
      </span>

      {state.status !== 'available' && (
        <button
          type="button"
          className={styles.check}
          disabled={state.status === 'checking'}
          onClick={() => void checkForUpdates()}
        >
          {t('shell.update.check')}
        </button>
      )}
    </p>
  );
}
