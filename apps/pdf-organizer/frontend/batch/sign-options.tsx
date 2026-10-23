import { useTranslation } from '@syntelab/i18n';
import type { ReactNode } from 'react';
import type { LoadedPicture } from '../document/load-picture';
import shapeStyles from '../organize/shape-dialog.module.css';
import { CertificatePicker } from '../sign/certificate-picker';
import type { CertificateChoice } from '../sign/certificate-picker';
import { LookPicker } from '../sign/look-picker';
import { hostOf } from '../sign/sign-dialog';
import type { LookChoice } from '../sign/look-picker';
import type { SignatureFacts } from '../sign/signature-presets';
import signStyles from '../sign/signing.module.css';
import { SIGN_PAGES } from './sign-settings';
import type { SignSettings } from './sign-settings';
import { SpotPlaces } from './spot-picker';
import styles from './batch-view.module.css';

export interface SignOptionsProps {
  readonly certificate: CertificateChoice;
  readonly looks: LookChoice;
  readonly settings: SignSettings;
  readonly onChange: (part: Partial<SignSettings>) => void;
  /** What the look is shown with. */
  readonly facts: SignatureFacts;
  readonly onPickPicture: () => Promise<LoadedPicture | null>;
  readonly disabled: boolean;
  /** The files as they come out, on which the box of the signature is moved. */
  readonly preview: ReactNode;
  /** The time-stamping authority each signature gets a time stamp from (as Settings say); null: none. */
  readonly timeStamp: string | null;
}

/**
 * The choices of signing many files with a certificate, in the order they are
 * made: which certificate, on which pages of each file the signature shows,
 * where on them and how it looks; then what it says and whether it closes the
 * documents.
 */
export function SignOptions({ certificate, looks, settings, onChange, facts, onPickPicture, disabled, preview, timeStamp }: SignOptionsProps) {
  const t = useTranslation();
  const shown = settings.pages !== 'none';
  return (
    <>
      <CertificatePicker choice={certificate} disabled={disabled} />

      <div className={styles.row}>
        <span>{t('pdf-organizer.batch.signPage')}</span>
      </div>
      <div role="radiogroup" aria-label={t('pdf-organizer.batch.signPage')} className={signStyles.sources}>
        {SIGN_PAGES.map((pages) => (
          <button key={pages} type="button" role="radio" aria-checked={settings.pages === pages} className={signStyles.source} disabled={disabled} onClick={() => onChange({ pages })}>
            {t(`pdf-organizer.batch.signPage.${pages}`)}
          </button>
        ))}
      </div>
      <p className={shapeStyles.lead}>{t(`pdf-organizer.batch.signPageNote.${settings.pages}`)}</p>

      {shown && (
        <>
          {preview}
          <SpotPlaces spot={settings.spot} onChange={(spot) => onChange({ spot })} disabled={disabled} />
          <LookPicker looks={looks} facts={facts} onPickPicture={onPickPicture} disabled={disabled} />
        </>
      )}

      <details className={signStyles.more}>
        <summary>{t('pdf-organizer.sign.reasonAndPlace')}</summary>
        <p className={shapeStyles.lead}>{t('pdf-organizer.sign.reasonAndPlaceNote')}</p>
        <div className={signStyles.pair}>
          <label>
            <span>{t('pdf-organizer.sign.reason')}</span>
            <input type="text" className={signStyles.field} dir="auto" maxLength={200} value={settings.reason} disabled={disabled} onChange={(event) => onChange({ reason: event.target.value })} />
          </label>
          <label>
            <span>{t('pdf-organizer.sign.location')}</span>
            <input type="text" className={signStyles.field} dir="auto" maxLength={200} value={settings.location} disabled={disabled} onChange={(event) => onChange({ location: event.target.value })} />
          </label>
        </div>
      </details>

      <label className={shapeStyles.choice}>
        <input type="checkbox" checked={settings.lock} disabled={disabled} onChange={(event) => onChange({ lock: event.target.checked })} />
        {t('pdf-organizer.sign.lock')}
      </label>
      <p className={shapeStyles.lead}>{t(settings.lock ? 'pdf-organizer.sign.lockNote' : 'pdf-organizer.sign.noLockNote')}</p>
      <p className={shapeStyles.lead}>{timeStamp ? t('pdf-organizer.batch.timeStamp', { server: hostOf(timeStamp) }) : t('pdf-organizer.batch.noTimeStamp')}</p>
    </>
  );
}
