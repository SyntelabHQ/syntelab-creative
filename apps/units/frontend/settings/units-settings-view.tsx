import { useI18n } from '@syntelab/i18n';
import type { AppSettingsProps } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useState } from 'react';
import { localNumber } from '../format/local-number';
import type { Thousands } from '../format/local-number';
import { readOwnUnits, saveAllOwnUnits, saveOwnUnits, useOwnUnits } from '../own/own-units';
import type { OwnUnit } from '../own/own-units';
import { PrecisionSetting } from './precision-setting';
import { changeSettings, DEFAULT_SETTINGS, useUnitsSettings } from './units-settings';
import styles from './units-settings-view.module.css';

/** How a unit of the user's own is said, on one line: `1 pc = 0.75 m`, or its formula. */
const said = (unit: OwnUnit, symbolOf: (id: string) => string): string =>
  unit.toReference !== undefined ? `${symbolOf(unit.reference)} = ${unit.toReference}` : `1 ${unit.symbol} = ${unit.factor ?? '1'} ${symbolOf(unit.reference)}${unit.offset ? ` + ${unit.offset}` : ''}`;

/**
 * Units' own part of Settings: how converters open, how values are written,
 * the precision of each unit (`precision-setting`), the units tables start with, and
 * the units of the user's own, of every converter.
 */
export function UnitsSettingsView({ host }: AppSettingsProps) {
  const { t, language } = useI18n();
  const settings = useUnitsSettings(host);
  const own = useOwnUnits(host);
  /** The units of the user's own as text, to be copied out; and text put in, to be read. */
  const [moving, setMoving] = useState<'out' | 'in' | null>(null);
  const [text, setText] = useState('');
  const [told, setTold] = useState<{ readonly key: string; readonly problem?: boolean; readonly count?: number } | null>(null);

  const converters = Object.keys(own);
  const starting = Object.entries(settings.startsWith);
  /** A unit by its name: one of the program by the translations, one of the user's own by the name it was given. */
  const nameOf = (converter: string, unit: string) => own[converter]?.find((known) => known.id === unit)?.name ?? t(`units.unit.${converter}.${unit}`);

  const read = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return setTold({ key: 'units.settings.own.notRead', problem: true });
    }
    const units = readOwnUnits(parsed);
    const count = Object.values(units).reduce((sum, listed) => sum + listed.length, 0);
    if (count === 0) return setTold({ key: 'units.settings.own.notRead', problem: true });
    // Added to what is there; a unit with the id of one that is there takes its place.
    const merged: Record<string, readonly OwnUnit[]> = { ...own };
    for (const [converter, listed] of Object.entries(units)) merged[converter] = [...(merged[converter] ?? []).filter((known) => !listed.some((unit) => unit.id === known.id)), ...listed];
    saveAllOwnUnits(host, merged);
    setMoving(null);
    setText('');
    setTold({ key: 'units.settings.own.read', count });
  };

  return (
    <div className={styles.settings}>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('units.settings.opening')}</h2>
        <div className={styles.rows}>
          <label className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{t('units.settings.ownTab')}</span>
              <span className={styles.rowHint}>{t('units.settings.ownTabHint')}</span>
            </span>
            <input type="checkbox" className={styles.switch} checked={!settings.sameTab} onChange={(event) => changeSettings(host, { sameTab: !event.target.checked })} />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('units.settings.values')}</h2>
        <div className={styles.rows}>
          <label className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{t('units.command.extremesInFull')}</span>
              <span className={styles.rowHint}>{t('units.hint.extremesInFull')}</span>
            </span>
            <input type="checkbox" className={styles.switch} checked={settings.extremes === 'full'} onChange={(event) => changeSettings(host, { extremes: event.target.checked ? 'full' : 'scientific' })} />
          </label>
          <label className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{t('units.settings.thousands')}</span>
              <span className={styles.rowHint}>{t('units.settings.thousandsHint')}</span>
            </span>
            <select className={styles.select} style={{ flex: 'none' }} dir="ltr" value={settings.between} onChange={(event) => changeSettings(host, { between: event.target.value as Thousands })}>
              {(['none', 'space', 'comma'] as const).map((choice) => (
                <option key={choice} value={choice}>
                  {localNumber('10000.000', language, choice)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{t('units.command.rowNumbers')}</span>
              <span className={styles.rowHint}>{t('units.hint.rowNumbers')}</span>
            </span>
            <input type="checkbox" className={styles.switch} checked={settings.rowNumbers} onChange={(event) => changeSettings(host, { rowNumbers: event.target.checked })} />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('units.settings.currency')}</h2>
        <p className={styles.note}>{t('units.settings.currencyNote')}</p>
        <div className={styles.rows}>
          <label className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{t('units.settings.ratesOnline')}</span>
              <span className={styles.rowHint}>{t('units.settings.ratesOnlineHint')}</span>
            </span>
            <input type="checkbox" className={styles.switch} checked={settings.ratesOnline} onChange={(event) => changeSettings(host, { ratesOnline: event.target.checked })} />
          </label>
          <label className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{t('units.settings.ratesCredit')}</span>
              <span className={styles.rowHint}>{t('units.settings.ratesCreditHint')}</span>
            </span>
            <input type="checkbox" className={styles.switch} checked={settings.ratesCredit} onChange={(event) => changeSettings(host, { ratesCredit: event.target.checked })} />
          </label>
        </div>
      </section>

      <PrecisionSetting host={host} />

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('units.settings.starting')}</h2>
        <p className={styles.note}>{t('units.settings.startingNote')}</p>
        {starting.length > 0 && (
          <div className={styles.rows}>
            {starting.map(([converter, units]) => (
              <div key={converter} className={styles.row}>
                <span className={styles.rowText}>
                  <span className={styles.rowLabel}>{t(`units.converter.${converter}`)}</span>
                  <span className={styles.rowHint}>{units.map((unit) => nameOf(converter, unit)).join(', ')}</span>
                </span>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={t('units.settings.startingBack')}
                  data-tooltip={t('units.settings.startingBack')}
                  onClick={() => {
                    const { [converter]: _before, ...rest } = settings.startsWith;
                    changeSettings(host, { startsWith: rest });
                  }}
                >
                  <Icon name="arrow-rotate-left" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('units.settings.own')}</h2>
        <p className={styles.note}>{t('units.settings.ownNote')}</p>
        {converters.length > 0 && (
          <div className={styles.rows}>
            {converters.flatMap((converter) => {
              const listed = own[converter] ?? [];
              const symbolOf = (id: string) => listed.find((unit) => unit.id === id)?.symbol ?? id;
              return listed.map((unit) => (
                <div key={`${converter}.${unit.id}`} className={styles.row}>
                  <span className={styles.rowText}>
                    <span className={styles.rowLabel}>
                      {unit.name} <span dir="ltr">({unit.symbol})</span>
                    </span>
                    <span className={styles.rowHint}>
                      {t(`units.converter.${converter}`)} · <span dir="ltr">{said(unit, symbolOf)}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.remove}
                    data-danger="true"
                    aria-label={t('units.own.remove')}
                    data-tooltip={t('units.own.remove')}
                    onClick={() => {
                      // Units said by the one that goes go with it.
                      const gone = new Set([unit.id]);
                      for (const other of listed) if (gone.has(other.reference)) gone.add(other.id);
                      saveOwnUnits(host, converter, listed.filter((other) => !gone.has(other.id)));
                      setTold({ key: 'units.own.removed', count: gone.size });
                    }}
                  >
                    <Icon name="trash-can" size={13} />
                  </button>
                </div>
              ));
            })}
          </div>
        )}
        <div className={styles.actions}>
          <Button
            disabled={converters.length === 0}
            onClick={() => {
              setText(JSON.stringify(own, null, 2));
              setMoving(moving === 'out' ? null : 'out');
              setTold(null);
            }}
          >
            <Icon name="file-export" size={14} />
            {t('units.settings.own.export')}
          </Button>
          <Button
            onClick={() => {
              setText('');
              setMoving(moving === 'in' ? null : 'in');
              setTold(null);
            }}
          >
            <Icon name="file-arrow-down" size={14} />
            {t('units.settings.own.import')}
          </Button>
          {told && (
            <span className={styles.told} role="status" data-problem={told.problem === true}>
              {t(told.key, { count: told.count ?? 0 })}
            </span>
          )}
        </div>
        {moving && (
          <div className={styles.moving}>
            <p className={styles.note}>{t(moving === 'out' ? 'units.settings.own.exportNote' : 'units.settings.own.importNote')}</p>
            <textarea className={styles.text} dir="ltr" spellCheck={false} rows={10} readOnly={moving === 'out'} value={text} aria-label={t(moving === 'out' ? 'units.settings.own.export' : 'units.settings.own.import')} onChange={(event) => setText(event.target.value)} onFocus={(event) => moving === 'out' && event.target.select()} />
            <div className={styles.actions}>
              {moving === 'out' ? (
                <Button variant="primary" onClick={() => void navigator.clipboard?.writeText(text).then(() => setTold({ key: 'units.smart.copied' }))}>
                  <Icon name="copy" size={14} />
                  {t('units.bar.copy')}
                </Button>
              ) : (
                <Button variant="primary" disabled={text.trim() === ''} onClick={read}>
                  {t('units.settings.own.read.action')}
                </Button>
              )}
              <Button onClick={() => setMoving(null)}>{t('common.action.close')}</Button>
            </div>
          </div>
        )}
      </section>

      <div className={styles.actions}>
        <Button onClick={() => changeSettings(host, DEFAULT_SETTINGS)}>
          <Icon name="rotate-left" size={14} />
          {t('units.settings.reset')}
        </Button>
      </div>
    </div>
  );
}
