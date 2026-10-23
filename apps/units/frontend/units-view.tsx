import { useTranslation } from '@syntelab/i18n';
import { useTabCommands } from '@syntelab/shell-api';
import type { AppViewProps } from '@syntelab/shell-api';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { unitsCommands } from './commands';
import { COMING, listConverters } from './engine/units-api';
import type { ConverterEntry } from './engine/units-api';
import { changeSettings, useUnitsSettings } from './settings/units-settings';
import { SmartConverter } from './smart/smart-converter';
import { TableView } from './table/table-view';
import styles from './units-view.module.css';

const SMART_KEY = 'smartConverter';
let tabCount = 0;

/**
 * One Units tab. It opens on the smart converter; choosing a converter from
 * the menus shows its table in the same tab, or in a tab of its own when the
 * settings say so. A tab opened for one converter (`params.converter`) shows
 * that table from the start.
 */
export function UnitsView({ host }: AppViewProps) {
  const t = useTranslation();
  const settings = useUnitsSettings(host);
  const [converters, setConverters] = useState<readonly ConverterEntry[]>([]);
  /** The converter the smart converter is on: the one used last. */
  const [smart, setSmart] = useState(() => host.loadData<string>(SMART_KEY) ?? '');
  /** The converter whose table is shown; null while the smart converter is. */
  const [open, setOpen] = useState<string | null>(host.params.converter ?? null);
  /** A converter asked for while the table has values: the user is asked first. */
  const [asked, setAsked] = useState<string | 'smart' | null>(null);
  const filled = useRef(0);
  /** What this tab's tables are named on the Rust side. */
  const tab = useRef(`tab-${++tabCount}-${Date.now()}`);

  useEffect(() => {
    let cancelled = false;
    void listConverters(host).then(
      (listed) => !cancelled && setConverters(listed),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [host.invoke]);

  const shownSmart = converters.some((known) => known.id === smart) ? smart : (converters[0]?.id ?? '');
  const chooseSmart = (id: string) => {
    setSmart(id);
    host.saveData(SMART_KEY, id);
  };

  const inNewTab = (id: string) => host.openTab({ key: `converter:${id}`, title: t(`units.converter.${id}`), params: { converter: id } });
  const go = (target: string | 'smart') => {
    filled.current = 0;
    setOpen(target === 'smart' ? null : target);
  };
  /** A converter chosen from the menus, or the way back to the smart converter. */
  const choose = (target: string | 'smart') => {
    if (target === (open ?? 'smart')) return;
    if (target !== 'smart' && !settings.sameTab) return inNewTab(target);
    // Values typed in the table would be lost: asked first. Never for the smart converter, which keeps nothing to lose.
    if (open !== null && filled.current > 0) return setAsked(target);
    go(target);
  };

  const commands = useMemo(
    () =>
      unitsCommands({
        converters,
        openConverter: open,
        rowNumbers: settings.rowNumbers,
        extremesInFull: settings.extremes === 'full',
        panelShown: settings.panelShown,
        onConverter: choose,
        onSmart: () => choose('smart'),
        onRowNumbers: () => changeSettings(host, { rowNumbers: !settings.rowNumbers }),
        onExtremes: () => changeSettings(host, { extremes: settings.extremes === 'full' ? 'scientific' : 'full' }),
        onPanel: () => changeSettings(host, { panelShown: !settings.panelShown }),
        onClose: () => host.closeTab(),
      }),
    // `host` changes when the tab moves to the back; what it opens does not.
    [converters, open, settings.sameTab, settings.rowNumbers, settings.extremes, settings.panelShown, host.closeTab, host.openSettings, host.openTab, t],
  );
  useTabCommands(host, commands);

  return (
    <div className={styles.tab}>
      {open !== null ? (
        <TableView host={host} converterId={open} table={`${tab.current}:${open}`} onFilled={(count) => (filled.current = count)} />
      ) : (
        shownSmart !== '' && <SmartConverter host={host} converters={converters.filter((known) => known.category === 'essentials')} coming={COMING.filter((coming) => coming.category === 'essentials' && !converters.some((known) => known.id === coming.id))} converterId={shownSmart} onConverter={chooseSmart} onOpenTable={(id) => choose(id)} />
      )}

      <Dialog open={asked !== null} onClose={() => setAsked(null)} title={t('units.leave.title')} closeLabel={t('common.action.close')}>
        <div className={styles.leave}>
          <p>{t('units.leave.lead')}</p>
          <div className={styles.leaveActions}>
            <Button onClick={() => setAsked(null)}>{t('common.action.cancel')}</Button>
            {asked !== null && asked !== 'smart' && (
              <Button
                onClick={() => {
                  inNewTab(asked);
                  setAsked(null);
                }}
              >
                {t('units.leave.newTab')}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => {
                if (asked !== null) go(asked);
                setAsked(null);
              }}
            >
              {t('units.leave.continue')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
