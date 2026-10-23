import { useTranslation } from '@syntelab/i18n';
import type { AppSettingsProps } from '@syntelab/shell-api';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import type { ReactNode } from 'react';
import { SHORTCUTS } from '../commands';
import { changeSettings, DEFAULT_SETTINGS, EDITOR_FONTS, FASTEST_PACE, LARGEST_FONT_SIZE, NEW_LINE_ENDINGS, PACES, SETTING_KEYS, SLOWEST_PACE, SMALLEST_FONT_SIZE, useScribeSettings } from './scribe-settings';
import type { EditorFont, NewLineEnding, ScribeSettings, SettingKey } from './scribe-settings';
import styles from './settings.module.css';

/** One setting: its name, its control, and a button that puts it back as it shipped. */
function Row({ label, hint, isDefault, onRevert, children }: { label: string; hint?: string; isDefault: boolean; onRevert: () => void; children: ReactNode }) {
  const t = useTranslation();
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {hint && <span className={styles.rowHint}>{hint}</span>}
      </div>
      <div className={styles.rowControl}>{children}</div>
      <IconButton variant="ghost" className={styles.revert} aria-label={t('scribe.settings.revert')} tooltipSide="bottom-end" disabled={isDefault} onClick={onRevert}>
        <Icon name="arrow-rotate-left" size={14} />
      </IconButton>
    </div>
  );
}

/** The keys of a command as people read them: Ctrl+Shift+S. */
function keysOf(shortcut: string): string {
  return shortcut.replace('Mod', /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl');
}

/** Scribe's own part of Settings. Every setting can be put back on its own, or all at once. */
export function ScribeSettingsView({ host }: AppSettingsProps) {
  const t = useTranslation();
  const settings = useScribeSettings(host);
  const change = (changed: Partial<ScribeSettings>) => changeSettings(host, changed);
  const revert = (key: SettingKey) => ({ isDefault: settings[key] === DEFAULT_SETTINGS[key], onRevert: () => change({ [key]: DEFAULT_SETTINGS[key] }) });
  const allDefault = SETTING_KEYS.every((key) => settings[key] === DEFAULT_SETTINGS[key]);
  const name = (key: SettingKey) => t(`scribe.settings.${key}`);

  const switchRow = (key: 'wrap' | 'lineNumbers' | 'newMark' | 'previewShown') => (
    <Row label={name(key)} hint={t(`scribe.settings.${key}Hint`)} {...revert(key)}>
      <input type="checkbox" className={styles.switch} checked={settings[key]} aria-label={name(key)} onChange={(event) => change({ [key]: event.target.checked })} />
    </Row>
  );

  return (
    <div className={styles.settings}>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('scribe.settings.editor')}</h2>
        <p className={styles.note}>{t('scribe.settings.editorNote')}</p>
        <div className={styles.rows}>
          <Row label={name('font')} hint={t(`scribe.settings.font.about.${settings.font}`)} {...revert('font')}>
            <select className={styles.select} value={settings.font} aria-label={name('font')} onChange={(event) => change({ font: event.target.value as EditorFont })}>
              {EDITOR_FONTS.map((font) => (
                <option key={font} value={font}>
                  {t(`scribe.settings.font.${font}`)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={name('fontSize')} hint={t('scribe.settings.fontSizeHint')} {...revert('fontSize')}>
            <span className={styles.withUnit}>
              <input
                type="number"
                className={styles.select}
                min={SMALLEST_FONT_SIZE}
                max={LARGEST_FONT_SIZE}
                value={settings.fontSize}
                aria-label={name('fontSize')}
                onChange={(event) => Number.isFinite(event.target.valueAsNumber) && change({ fontSize: event.target.valueAsNumber })}
              />
              px
            </span>
          </Row>
          {switchRow('wrap')}
          {switchRow('lineNumbers')}
          {switchRow('previewShown')}
        </div>
        <p className={styles.sample} data-font={settings.font} style={{ fontSize: settings.fontSize }} lang="ro">
          {t('scribe.settings.sample')}
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('scribe.settings.newText')}</h2>
        <p className={styles.note}>{t('scribe.settings.newTextNote')}</p>
        <div className={styles.rows}>
          <Row label={name('newLineEnding')} hint={t(`scribe.settings.newLineEnding.about.${settings.newLineEnding}`)} {...revert('newLineEnding')}>
            <select className={styles.select} value={settings.newLineEnding} aria-label={name('newLineEnding')} onChange={(event) => change({ newLineEnding: event.target.value as NewLineEnding })}>
              {NEW_LINE_ENDINGS.map((ending) => (
                <option key={ending} value={ending}>
                  {t(`scribe.settings.newLineEnding.${ending}`)}
                </option>
              ))}
            </select>
          </Row>
          {switchRow('newMark')}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('scribe.settings.paces')}</h2>
        <p className={styles.note}>{t('scribe.settings.pacesNote')}</p>
        <div className={styles.rows}>
          {PACES.map((pace) => (
            <Row key={pace} label={name(pace)} {...revert(pace)}>
              <span className={styles.withUnit}>
                <input
                  type="number"
                  className={styles.select}
                  min={SLOWEST_PACE}
                  max={FASTEST_PACE}
                  value={settings[pace]}
                  aria-label={name(pace)}
                  onChange={(event) => Number.isFinite(event.target.valueAsNumber) && event.target.valueAsNumber >= SLOWEST_PACE && change({ [pace]: event.target.valueAsNumber })}
                />
                {t(pace === 'wordsPerPage' ? 'scribe.settings.words' : 'scribe.settings.wordsAMinute')}
              </span>
            </Row>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('scribe.settings.shortcuts')}</h2>
        <p className={styles.note}>{t('scribe.settings.shortcutsNote')}</p>
        <dl className={styles.keys}>
          {Object.entries(SHORTCUTS).map(([command, shortcut]) => (
            <div key={command} className={styles.keyRow}>
              <dt>{t(`scribe.command.${command}`)}</dt>
              <dd>
                <kbd>{keysOf(shortcut)}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className={styles.resetAll}>
        <p>{t('scribe.settings.resetAllNote')}</p>
        <Button disabled={allDefault} onClick={() => change(Object.fromEntries(SETTING_KEYS.map((key) => [key, DEFAULT_SETTINGS[key]])))}>
          <Icon name="arrow-rotate-left" size={14} />
          {t('scribe.settings.resetAll')}
        </Button>
      </div>
    </div>
  );
}
