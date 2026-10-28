import { useTranslation } from '@syntelab/i18n';
import { Button, Icon } from '@syntelab/ui-kit';
import { openSitePage } from '../links';
import styles from './donation-banner.module.css';

/** Always visible, never blocking. */
export function DonationBanner() {
  const t = useTranslation();

  return (
    <aside aria-label={t('shell.donate.label')} className={styles.banner}>
      <span className={styles.heart}>
        <Icon name="support" />
      </span>
      <span className={styles.text}>
        <strong className={styles.line}>{t('shell.donate.bannerSupport')}</strong>
        <span className={styles.line}>{t('shell.donate.bannerShare')}</span>
      </span>
      <Button className={styles.button} onClick={() => openSitePage('support')}>
        {t('shell.donate.button')}
      </Button>
    </aside>
  );
}
