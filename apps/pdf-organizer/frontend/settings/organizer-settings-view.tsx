import { useTranslation } from '@syntelab/i18n';
import type { AppSettingsProps } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import { OTHER_KEYS } from '../commands';
import { oneName } from '../batch/batch-actions';
import { extractedEachName, extractedName, newDocumentName } from '../document/names';
import { SheetSelect } from '../document/sheet-select';
import { fromUnit, toUnit } from '../organize/crop-frame';
import {
  DEFAULT_SETTINGS,
  isDefault,
  isTimeStampServer,
  loadSettings,
  MEASURE_UNITS,
  OPEN_ZOOMS,
  PRINT_ORIENTATIONS,
  PRINT_SCALINGS,
  PRINTER_SHEET,
  QUICK_TOOLS,
  saveSettings,
  SETTING_KEYS,
  useOrganizerSettings,
} from './organizer-settings';
import type { OpenZoom, OrganizerSettings, QuickTool, SettingKey } from './organizer-settings';
import { SettingRow } from './setting-row';
import { ShortcutEditor } from './shortcut-editor';
import styles from './settings.module.css';

const ZOOM_KEYS: Record<OpenZoom, string> = {
  'fit-page': 'pdf-organizer.view.fitPage',
  'fit-width': 'pdf-organizer.view.fitWidth',
  'fit-height': 'pdf-organizer.view.fitHeight',
  actual: 'pdf-organizer.view.actualSize',
};

const TOOL_ICONS: Record<QuickTool, string> = {
  save: 'floppy-disk',
  print: 'print',
  history: 'arrow-rotate-left',
  pages: 'file',
  zoom: 'magnifying-glass-plus',
  fit: 'maximize',
  rotate: 'rotate-right',
  find: 'magnifying-glass',
  organize: 'table-cells',
  share: 'share-nodes',
};

/** The file a name pattern is tried on, to show what it gives. */
const EXAMPLE_FILE = 'report.pdf';

/** PDF Organizer's own part of Settings. Every setting can be put back on its own, or all at once. */
export function OrganizerSettingsView({ host }: AppSettingsProps) {
  const t = useTranslation();
  const settings = useOrganizerSettings(host);
  // From the settings as they are at that moment, not as they were when this was drawn.
  const change = (changed: Partial<OrganizerSettings>) => saveSettings(host, { ...loadSettings(host), ...changed });
  /** What a row needs to know and do about going back to the default. */
  const revert = (...keys: SettingKey[]) => ({
    isDefault: keys.every((key) => isDefault(settings, key)),
    onRevert: () => change(Object.fromEntries(keys.map((key) => [key, DEFAULT_SETTINGS[key]]))),
  });
  const allDefault = SETTING_KEYS.every((key) => isDefault(settings, key));

  const toggleTool = (tool: QuickTool) => {
    const shown = loadSettings(host).quickTools;
    change({ quickTools: QUICK_TOOLS.filter((known) => (known === tool ? !shown.includes(tool) : shown.includes(known))) });
  };

  /** A setting that is one of a few choices, as a row with a list. */
  // Under its name, a choice says what the option now chosen means: not everybody knows the words.
  const choiceRow = <K extends SettingKey>(key: K, options: readonly OrganizerSettings[K][], name: (option: OrganizerSettings[K]) => string) => (
    <SettingRow label={t(`pdf-organizer.settings.${key}`)} hint={t(`pdf-organizer.settings.${key}.about.${String(settings[key])}`)} {...revert(key)}>
      <select
        className={styles.select}
        value={String(settings[key])}
        aria-label={t(`pdf-organizer.settings.${key}`)}
        onChange={(event) => change({ [key]: options.find((option) => String(option) === event.target.value) } as Partial<OrganizerSettings>)}
      >
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {name(option)}
          </option>
        ))}
      </select>
    </SettingRow>
  );
  const switchRow = (key: 'showRulers' | 'showGrid' | 'warnSignedSave' | 'signAreaHint' | 'timeStampSignatures', hint?: string) => (
    <SettingRow label={t(`pdf-organizer.settings.${key}`)} hint={hint} {...revert(key)}>
      <input type="checkbox" className={styles.switch} checked={settings[key]} aria-label={t(`pdf-organizer.settings.${key}`)} onChange={(event) => change({ [key]: event.target.checked })} />
    </SettingRow>
  );

  const nameRow = (key: 'extractName' | 'extractEachName' | 'newName' | 'combinedName', example: string) => (
    <SettingRow label={t(`pdf-organizer.settings.${key}`)} hint={t(`pdf-organizer.settings.${key}Hint`)} wide {...revert(key)}>
      <span className={styles.nameField}>
        <input
          type="text"
          className={styles.text}
          value={settings[key]}
          spellCheck={false}
          aria-label={t(`pdf-organizer.settings.${key}`)}
          onChange={(event) => change({ [key]: event.target.value })}
        />
        <span className={styles.example}>{t('pdf-organizer.settings.nameExample', { name: example })}</span>
      </span>
    </SettingRow>
  );

  return (
    <div className={styles.settings}>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('pdf-organizer.settings.opening')}</h2>
        <p className={styles.note}>{t('pdf-organizer.settings.openingNote')}</p>
        <div className={styles.rows}>
          <SettingRow label={t('pdf-organizer.settings.openZoom')} hint={t(`pdf-organizer.settings.openZoom.about.${settings.openZoom}`)} {...revert('openZoom')}>
            <select
              className={styles.select}
              value={settings.openZoom}
              aria-label={t('pdf-organizer.settings.openZoom')}
              onChange={(event) => change({ openZoom: event.target.value as OpenZoom })}
            >
              {OPEN_ZOOMS.map((zoom) => (
                <option key={zoom} value={zoom}>
                  {t(ZOOM_KEYS[zoom])}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label={t('pdf-organizer.settings.openScrolling')} hint={t('pdf-organizer.settings.openScrollingHint')} {...revert('openScrolling')}>
            <input
              type="checkbox"
              className={styles.switch}
              checked={settings.openScrolling}
              aria-label={t('pdf-organizer.settings.openScrolling')}
              onChange={(event) => change({ openScrolling: event.target.checked })}
            />
          </SettingRow>
          <SettingRow label={t('pdf-organizer.settings.openThumbnails')} {...revert('openThumbnails')}>
            <input
              type="checkbox"
              className={styles.switch}
              checked={settings.openThumbnails}
              aria-label={t('pdf-organizer.settings.openThumbnails')}
              onChange={(event) => change({ openThumbnails: event.target.checked })}
            />
          </SettingRow>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('pdf-organizer.settings.measuring')}</h2>
        <p className={styles.note}>{t('pdf-organizer.settings.measuringNote')}</p>
        <div className={styles.rows}>
          {choiceRow('unit', MEASURE_UNITS, (unit) => t(`pdf-organizer.unit.${unit}Name`))}
          {switchRow('showRulers')}
          {switchRow('showGrid')}
          <SettingRow label={t('pdf-organizer.settings.gridSpacing')} {...revert('gridSpacing')}>
            <span className={styles.withUnit}>
              <input
                type="number"
                className={styles.select}
                min={0}
                step="any"
                value={toUnit(settings.gridSpacing, settings.unit)}
                aria-label={t('pdf-organizer.settings.gridSpacing')}
                onChange={(event) => {
                  const points = fromUnit(event.target.valueAsNumber, settings.unit);
                  if (points >= 2 && points <= 720) change({ gridSpacing: points });
                }}
              />
              {t(`pdf-organizer.unit.${settings.unit}`)}
            </span>
          </SettingRow>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('pdf-organizer.settings.printing')}</h2>
        <p className={styles.note}>{t('pdf-organizer.settings.printingNote')}</p>
        <div className={styles.rows}>
          <SettingRow label={t('pdf-organizer.settings.printSheet')} hint={t('pdf-organizer.settings.printSheetHint')} {...revert('printSheet')}>
            <SheetSelect className={styles.select} value={settings.printSheet} label={t('pdf-organizer.settings.printSheet')} onChange={(printSheet) => change({ printSheet })}>
              <option value={PRINTER_SHEET}>{t('pdf-organizer.settings.printSheet.printer')}</option>
            </SheetSelect>
          </SettingRow>
          {choiceRow('printOrientation', PRINT_ORIENTATIONS, (orientation) => t(`pdf-organizer.settings.printOrientation.${orientation}`))}
          {choiceRow('printScaling', PRINT_SCALINGS, (scaling) => t(`pdf-organizer.settings.printScaling.${scaling}`))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('pdf-organizer.settings.quickToolbar')}</h2>
        <p className={styles.note}>{t('pdf-organizer.settings.quickToolbarNote')}</p>
        <div className={styles.rows}>
          <SettingRow label={t('pdf-organizer.settings.quickTools')} wide {...revert('quickTools')}>
            <span className={styles.tools}>
              {QUICK_TOOLS.map((tool) => (
                <button key={tool} type="button" className={styles.tool} aria-pressed={settings.quickTools.includes(tool)} onClick={() => toggleTool(tool)}>
                  <Icon name={TOOL_ICONS[tool]} size={14} />
                  {t(`pdf-organizer.settings.tool.${tool}`)}
                </button>
              ))}
            </span>
          </SettingRow>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('pdf-organizer.settings.names')}</h2>
        <p className={styles.note}>{t('pdf-organizer.settings.namesNote')}</p>
        <div className={styles.rows}>
          {nameRow('extractName', extractedName(settings.extractName, EXAMPLE_FILE))}
          {nameRow('extractEachName', extractedEachName(settings.extractEachName, EXAMPLE_FILE, 1))}
          {nameRow('newName', newDocumentName(settings.newName, 1))}
          {nameRow('combinedName', oneName(settings.combinedName))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('pdf-organizer.settings.signing')}</h2>
        <div className={styles.rows}>
          {switchRow('warnSignedSave', t('pdf-organizer.settings.warnSignedSaveHint'))}
          {switchRow('signAreaHint', t('pdf-organizer.settings.signAreaHintHint'))}
          {switchRow('timeStampSignatures', t('pdf-organizer.settings.timeStampSignaturesHint'))}
          <SettingRow label={t('pdf-organizer.settings.timeStampServer')} hint={t('pdf-organizer.settings.timeStampServerHint')} wide {...revert('timeStampServer')}>
            <TimeStampServerField value={settings.timeStampServer} onChange={(timeStampServer) => change({ timeStampServer })} />
          </SettingRow>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('pdf-organizer.settings.shortcuts')}</h2>
        <p className={styles.note}>{t('pdf-organizer.settings.shortcutsNote')}</p>
        <ShortcutEditor chosen={settings.shortcuts} onChange={(shortcuts) => change({ shortcuts })} />
        <dl className={styles.keys}>
          {OTHER_KEYS.map(([keys, does]) => (
            <div key={keys} className={styles.keyRow}>
              <dt>{t(does)}</dt>
              <dd>
                <kbd>{t(keys)}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className={styles.resetAll}>
        <p>{t('pdf-organizer.settings.resetAllNote')}</p>
        <Button disabled={allDefault} onClick={() => saveSettings(host, DEFAULT_SETTINGS)}>
          <Icon name="arrow-rotate-left" size={14} />
          {t('pdf-organizer.settings.resetAll')}
        </Button>
      </div>
    </div>
  );
}

/** The address of the time-stamping authority: kept only once it is an address one can be at. */
function TimeStampServerField({ value, onChange }: { readonly value: string; readonly onChange: (value: string) => void }) {
  const t = useTranslation();
  const [typed, setTyped] = useState(value);
  // Put back from elsewhere (the button beside it, "Reset all"): shown here too.
  useEffect(() => setTyped(value), [value]);
  const valid = isTimeStampServer(typed);
  return (
    <span className={styles.nameField}>
      <input
        type="url"
        className={styles.text}
        value={typed}
        spellCheck={false}
        aria-label={t('pdf-organizer.settings.timeStampServer')}
        aria-invalid={!valid}
        onChange={(event) => {
          setTyped(event.target.value);
          if (isTimeStampServer(event.target.value)) onChange(event.target.value.trim());
        }}
      />
      {!valid && <span className={styles.example}>{t('pdf-organizer.settings.timeStampServerWrong')}</span>}
    </span>
  );
}
