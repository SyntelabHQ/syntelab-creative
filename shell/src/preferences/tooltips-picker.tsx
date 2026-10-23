import { useTranslation } from '@syntelab/i18n';
import { useId } from 'react';
import { useStore } from '../state/create-store';
import styles from './pickers.module.css';
import { preferences, TOOLTIP_MODES, updatePreferences } from './preferences-store';

/** When the small texts that say what a button does show: at once, after a moment, or never. Everywhere in the program. */
export function TooltipsPicker() {
  const t = useTranslation();
  const { tooltips } = useStore(preferences);
  const labelId = useId();
  const noteId = useId();
  return (
    <div className={styles.options}>
      <span id={labelId}>{t('shell.tooltips.show')}</span>
      <div role="radiogroup" aria-labelledby={labelId} aria-describedby={noteId} className={styles.pills}>
        {TOOLTIP_MODES.map((mode) => (
          <button key={mode} type="button" role="radio" aria-checked={tooltips === mode} className={styles.pill} onClick={() => updatePreferences({ tooltips: mode })}>
            {t(`shell.tooltips.${mode}`)}
          </button>
        ))}
      </div>
      <p id={noteId} className={styles.note}>
        {t(`shell.tooltips.${tooltips}Note`)}
      </p>
    </div>
  );
}
