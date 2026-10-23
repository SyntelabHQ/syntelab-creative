import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { useEffect } from 'react';
import { useUnitsSettings } from '../settings/units-settings';
import styles from './rates-line.module.css';
import { ratesAreDue, refreshRates, useRates } from './rates-store';
import type { RatesRead } from './rates-store';

export interface RatesLineProps {
  readonly host: Pick<AppHost, 'invoke' | 'loadData' | 'saveData' | 'active'>;
}

/** The two services the rates come from, by name. Their own words and their addresses are in the manual. */
const SOURCES = 'ExchangeRate-API · CoinGecko';

/**
 * What the currency converter says of its rates: when those of countries'
 * currencies and those of cryptocurrencies are of, that they are old when
 * they could not be read again, and the way to read them now. It also keeps
 * them up to date while it is on screen: when the tab comes back to the
 * front, and when the source of the countries' currencies changes them.
 */
export function RatesLine({ host }: RatesLineProps) {
  const { t, language } = useI18n();
  const rates = useRates();
  const settings = useUnitsSettings(host);

  // In front (again): what is due is read. Nothing is asked while the tab is at the back.
  useEffect(() => {
    if (host.active && ratesAreDue()) void refreshRates(host);
  }, [host.active]);

  // The currencies of countries change once a day: read when their source says they have. Cryptocurrencies are not read on a timer.
  useEffect(() => {
    const next = rates.fiat?.next ?? 0;
    if (!host.active || next === 0) return;
    const wait = Math.max(next * 1000 - Date.now(), 0) + 60_000;
    // A timer cannot wait longer than about 24 days: beyond that, coming back to the tab reads them.
    if (wait > 2_000_000_000) return;
    const timer = setTimeout(() => void refreshRates(host), wait);
    return () => clearTimeout(timer);
  }, [host.active, rates.fiat?.next]);

  const when = (read: RatesRead) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(read.time * 1000));
  const part = (kind: 'fiat' | 'coins', read: RatesRead | null) => (
    <span className={styles.part} data-old={rates.failed.includes(kind)}>
      {read ? t(`units.rates.${kind}`, { when: when(read) }) : t(`units.rates.${kind}None`)}
      {read && rates.failed.includes(kind) && ` (${t('units.rates.old')})`}
    </span>
  );

  return (
    <div className={styles.line} role="status">
      {part('fiat', rates.fiat)}
      {part('coins', rates.coins)}
      {!settings.ratesOnline && <span className={styles.part}>{t('units.rates.offline')}</span>}
      <button type="button" className={styles.refresh} disabled={rates.reading || !settings.ratesOnline} data-reading={rates.reading} aria-label={t('units.rates.refresh')} data-tooltip={t('units.rates.refreshHint')} onClick={() => void refreshRates(host, true)}>
        <Icon name="rotate" size={12} />
        {t(rates.reading ? 'units.rates.reading' : 'units.rates.refresh')}
      </button>
      {settings.ratesCredit && (
        <span className={styles.credits} data-tooltip={t('units.rates.sourcesHint')}>
          {t('units.rates.sources', { names: SOURCES })}
        </span>
      )}
    </div>
  );
}
