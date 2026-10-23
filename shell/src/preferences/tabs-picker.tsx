import { useTranslation } from '@syntelab/i18n';
import { useId } from 'react';
import { useStore } from '../state/create-store';
import styles from './pickers.module.css';
import { preferences, TAB_MARKS, updatePreferences } from './preferences-store';

/** How the tabs look: whether Start keeps a tab of its own, and what marks the tabs of an app. */
export function TabsPicker() {
  const t = useTranslation();
  const { startTabAlways, tabMark } = useStore(preferences);
  const noteId = useId();
  const markId = useId();

  return (
    <div className={styles.options}>
      <label className={styles.option}>
        <input type="checkbox" checked={startTabAlways} aria-describedby={noteId} onChange={(event) => updatePreferences({ startTabAlways: event.target.checked })} />
        {t('shell.tabs.startAlways')}
      </label>
      <p id={noteId} className={styles.note}>
        {t('shell.tabs.startAlwaysNote')}
      </p>
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
