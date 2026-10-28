import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog, Icon } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import { preferences, updatePreferences } from '../preferences';
import { useStore } from '../state/create-store';
import { openSitePageNow, siteNotice } from './site-links';
import styles from './site-notice.module.css';

/**
 * Before the browser opens the feedback or support page: what it is for, in
 * the color of its button (purple for feedback, green for support). Rendered
 * once by the shell.
 */
export function SiteNotice() {
  const t = useTranslation();
  const page = useStore(siteNotice);
  const { siteNoticesOff } = useStore(preferences);
  const [skip, setSkip] = useState(false);
  // Each time it opens, the box starts unticked.
  useEffect(() => setSkip(false), [page]);
  const close = () => siteNotice.set(null);
  const shown = page ?? 'feedback';

  const go = () => {
    if (skip && !siteNoticesOff.includes(shown)) updatePreferences({ siteNoticesOff: [...siteNoticesOff, shown] });
    close();
    openSitePageNow(shown);
  };

  return (
    <Dialog open={page !== null} onClose={close} title={t(shown === 'support' ? 'shell.donate.button' : 'shell.help.feedback')} closeLabel={t('common.action.close')}>
      <div className={styles.notice} data-page={shown}>
        <div className={styles.card}>
          <span className={styles.icon}>
            <Icon name={shown === 'support' ? 'support' : 'feedback'} size={20} />
          </span>
          <div className={styles.text}>
            {shown === 'support' ? (
              <>
                <h3 className={styles.heading}>{t('shell.siteNotice.support.title')}</h3>
                <p>{t('shell.siteNotice.support.share')}</p>
                <p>{t('shell.siteNotice.support.give')}</p>
              </>
            ) : (
              <>
                <h3 className={styles.heading}>{t('shell.siteNotice.feedback.title')}</h3>
                <p>{t('shell.siteNotice.feedback.body')}</p>
              </>
            )}
          </div>
        </div>
        <p className={styles.where}>{t('shell.siteNotice.where')}</p>
        <label className={styles.skip}>
          <input type="checkbox" checked={skip} onChange={(event) => setSkip(event.target.checked)} />
          {t('shell.siteNotice.skip')}
        </label>
        <div className={styles.actions}>
          <Button onClick={close}>{t('common.action.cancel')}</Button>
          <Button variant="primary" className={styles.go} onClick={go}>
            {t(shown === 'support' ? 'shell.siteNotice.support.open' : 'shell.siteNotice.feedback.open')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
