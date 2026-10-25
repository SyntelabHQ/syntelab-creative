import { useTranslation } from '@syntelab/i18n';
import { useId } from 'react';
import { useStore } from '../state/create-store';
import styles from './pickers.module.css';
import { preferences, TAB_MARKS, updatePreferences } from './preferences-store';

/** How the tabs look: what marks the tabs of an app. */
export function TabsPicker() {
  const t = useTranslation();
  const { tabMark } = useStore(preferences);
  const markId = useId();

  return (
    <div className={styles.options}>
      <div className={styles.inline}>
        <span id={markId}>{t('shell.tabs.mark')}</span>
        <div role="radiogroup" aria-labelledby={markId} className={styles.pills}>
          {TAB_MARKS.map((mark) => (
            <button key={mark} type="button" role="radio" aria-checked={tabMark === mark} className={styles.pill} onClick={() => updatePreferences({ tabMark: mark })}>
              {t(`shell.tabs.mark.${mark}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
