import { useI18n } from '@syntelab/i18n';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import type { SignaturesVerdict } from '../document/use-file-counts';
import styles from './signatures-banner.module.css';

export interface SignaturesBannerProps {
  readonly verdict: SignaturesVerdict;
  /** Opens the signatures, each with what its check says. */
  readonly onShow: () => void;
  readonly onDismiss: () => void;
}

const TONES = { valid: 'good', unconfirmed: 'warning', added: 'warning', invalid: 'bad' } as const;

/** The line over the pages of a signed document: what its signatures say, checked when it opened. */
export function SignaturesBanner({ verdict, onShow, onDismiss }: SignaturesBannerProps) {
  const { t } = useI18n();
  const tone = TONES[verdict];
  return (
    <div className={styles.banner} role="status" data-tone={tone}>
      <span className={styles.mark}>
        <Icon name={tone === 'good' ? 'certificate' : 'triangle-exclamation'} size={16} />
      </span>
      <span className={styles.text}>{t(`pdf-organizer.signedBanner.${verdict}`)}</span>
      <Button variant="outline" className={styles.show} onClick={onShow}>
        {t('pdf-organizer.signedBanner.panel')}
      </Button>
      <IconButton variant="ghost" aria-label={t('pdf-organizer.notice.dismiss')} tooltipSide="bottom-end" onClick={onDismiss}>
        <Icon name="xmark" size={14} />
      </IconButton>
    </div>
  );
}
