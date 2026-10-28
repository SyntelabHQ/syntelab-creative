import { useTranslation } from '@syntelab/i18n';
import { Button } from '@syntelab/ui-kit';
import { BrandLogo, Wordmark } from '../brand';
import { LanguagePicker, ThemePicker, updatePreferences } from '../preferences';
import styles from './first-run-screen.module.css';

/**
 * Shown once, before the main window: theme and language, with sensible
 * defaults. There is no layout to choose: every app has the same frame, with
 * its tools on the side.
 */
export function FirstRunScreen() {
  const t = useTranslation();

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <header className={styles.header}>
          <BrandLogo />
          <Wordmark />
          <p className={styles.title}>{t('shell.firstRun.title')}</p>
          <p className={styles.hint}>{t('shell.firstRun.hint')}</p>
        </header>
        <div className={styles.fields}>
          <ThemePicker />
          <LanguagePicker />
        </div>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => updatePreferences({ firstRunDone: true })}>
            {t('common.action.continue')}
          </Button>
        </div>
      </div>
    </main>
  );
}
