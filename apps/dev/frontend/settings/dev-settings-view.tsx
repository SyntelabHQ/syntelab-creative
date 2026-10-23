import { useTranslation } from '@syntelab/i18n';
import type { AppSettingsProps } from '@syntelab/shell-api';
import { useState } from 'react';
import { TOOLS } from '../tools/catalog';
import { changeSettings, LAST_TOOL_KEY, useDevSettings } from './dev-settings';
import styles from './dev-settings-view.module.css';

/** The part of Settings that belongs to Dev: how tools open, what the app keeps, and putting that back as it ships. */
export function DevSettingsView({ host }: AppSettingsProps) {
  const t = useTranslation();
  const settings = useDevSettings(host);
  /** What was just put back, to say so. */
  const [done, setDone] = useState<'options' | 'pins' | null>(null);

  const resetOptions = () => {
    // Every tool keeps its choices under its own name; the layout of the frame is the View menu's, and stays.
    for (const tool of TOOLS) host.saveData(`${tool.id}.options`, null);
    setDone('options');
  };
  const resetPins = () => {
    host.saveData('pins', []);
    host.saveData(LAST_TOOL_KEY, null);
    setDone('pins');
  };

  return (
    <div className={styles.settings}>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('dev.settings.opening')}</h2>
        <div className={styles.rows}>
          <label className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{t('dev.settings.ownTab')}</span>
              <span className={styles.rowHint}>{t('dev.settings.ownTabHint')}</span>
            </span>
            <input type="checkbox" className={styles.switch} checked={!settings.sameTab} onChange={(event) => changeSettings(host, { sameTab: !event.target.checked })} />
          </label>
          <label className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{t('dev.settings.startOnLast')}</span>
              <span className={styles.rowHint}>{t('dev.settings.startOnLastHint')}</span>
            </span>
            <input type="checkbox" className={styles.switch} checked={settings.startOn === 'last'} onChange={(event) => changeSettings(host, { startOn: event.target.checked ? 'last' : 'start' })} />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('dev.settings.reset')}</h2>
        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{t('dev.settings.resetOptions')}</span>
              <span className={styles.rowHint}>{t(done === 'options' ? 'dev.settings.resetDone' : 'dev.settings.resetOptionsHint')}</span>
            </span>
            <button type="button" className={styles.button} onClick={resetOptions}>
              {t('dev.settings.resetNow')}
            </button>
          </div>
          <div className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{t('dev.settings.resetPins')}</span>
              <span className={styles.rowHint}>{t(done === 'pins' ? 'dev.settings.resetDone' : 'dev.settings.resetPinsHint')}</span>
            </span>
            <button type="button" className={styles.button} onClick={resetPins}>
              {t('dev.settings.resetNow')}
            </button>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('dev.settings.kept')}</h2>
        <p className={styles.note}>{t('dev.settings.keptNote')}</p>
      </section>
    </div>
  );
}
