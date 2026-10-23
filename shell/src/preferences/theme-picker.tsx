import { useTranslation } from '@syntelab/i18n';
import { THEME_PREFERENCES } from '@syntelab/ui-kit';
import type { ThemePreference } from '@syntelab/ui-kit';
import { useId } from 'react';
import { useStore } from '../state/create-store';
import styles from './pickers.module.css';
import { preferences, updatePreferences } from './preferences-store';

const LABEL_KEYS: Record<ThemePreference, string> = {
  light: 'shell.theme.light',
  'light-gray': 'shell.theme.lightGray',
  'dark-gray': 'shell.theme.darkGray',
  dark: 'shell.theme.dark',
  auto: 'shell.theme.auto',
};

export function ThemePicker() {
  const t = useTranslation();
  const { theme } = useStore(preferences);
  const headingId = useId();

  return (
    <section className={styles.field}>
      <h2 id={headingId} className={styles.label}>
        {t('shell.settings.theme')}
      </h2>
      <div role="radiogroup" aria-labelledby={headingId} className={styles.pills}>
        {THEME_PREFERENCES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={theme === option}
            className={styles.pill}
            onClick={() => updatePreferences({ theme: option })}
          >
            {t(LABEL_KEYS[option])}
          </button>
        ))}
      </div>
    </section>
  );
}
