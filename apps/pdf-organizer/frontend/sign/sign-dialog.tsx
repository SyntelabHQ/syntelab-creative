import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import type { LoadedPicture } from '../document/load-picture';
import shapeStyles from '../organize/shape-dialog.module.css';
import { loadSettings } from '../settings/organizer-settings';
import { CertificatePicker, useCertificateChoice } from './certificate-picker';
import type { SigningCertificate } from './certificate-picker';
import { LookPicker, useSignatureLooks } from './look-picker';
import type { SignaturePreset } from './signature-presets';
import styles from './signing.module.css';

/** What the user decided in the window: who signs, what the signature says and shows. */
export interface SigningChoice extends SigningCertificate {
  readonly reason: string;
  readonly location: string;
  /** How it looks where it shows on the page. */
  readonly preset: SignaturePreset;
  /** No one can sign after this signature, and nothing more may be changed. */
  readonly lock: boolean;
  /** The address of the time-stamping authority that confirms when it was signed; null: no time stamp. */
  readonly timeStamp: string | null;
}

export interface SignDialogProps {
  readonly host: AppHost;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onChoose: (choice: SigningChoice) => void;
  /** The signature shows on a page, in the area the user has already dragged; false: nothing shows. */
  readonly visible: boolean;
  /** The document that is signed, and whether it has changes that are not in its file. */
  readonly documentId: number | undefined;
  readonly modified: boolean;
  /** Asks the user for a picture file; resolves to null when none was chosen or it cannot be read. */
  readonly onPickPicture: () => Promise<LoadedPicture | null>;
}

/**
 * Signing with a certificate, after the area of the signature was dragged on
 * the page: first which certificate (of the computer, a card or a token that
 * Windows shows among them, or a file), then how the signature looks there,
 * what else it says, and whether it closes the document.
 */
export function SignDialog({ host, open, onClose, onChoose, visible, documentId, modified, onPickPicture }: SignDialogProps) {
  const { t, language } = useI18n();
  const { invoke } = host;
  const certificate = useCertificateChoice(host, open);
  const looks = useSignatureLooks(host, open);
  /** The certificate settled on in the first step; null while that step is shown. */
  const [settled, setSettled] = useState<SigningCertificate | null>(null);
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [lock, setLock] = useState(false);
  const [stamped, setStamped] = useState(true);
  const server = loadSettings(host).timeStampServer;
  /** What the file of the document already has: signatures, and whether one of them closed it. */
  const [signed, setSigned] = useState<{ count: number; locked: boolean }>({ count: 0, locked: false });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Each signing starts with the certificate; closing a document is chosen anew each time.
    setSettled(null);
    setLock(false);
    setStamped(loadSettings(host).timeStampSignatures);
    if (documentId !== undefined) {
      invoke<{ signatures: { locks: boolean }[] }>('signatures', { documentId })
        .then((answer) => !cancelled && setSigned({ count: answer.signatures.length, locked: answer.signatures.some((signature) => signature.locks) }))
        .catch(() => !cancelled && setSigned({ count: 0, locked: false }));
    }
    return () => {
      cancelled = true;
    };
  }, [open, invoke, documentId, host]);

  // What the look is shown with: the signer when known, and this moment.
  const facts = {
    signer: settled?.signer ?? certificate.signer ?? t('pdf-organizer.sign.look.yourName'),
    moment: new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()),
    reason: reason.trim(),
    location: location.trim(),
  };

  const next = async () => {
    const chosen = await certificate.settle();
    if (chosen) setSettled(chosen);
  };

  const sign = () => {
    if (!settled) return;
    looks.remember();
    onChoose({ ...settled, reason: reason.trim(), location: location.trim(), preset: looks.preset, lock, timeStamp: stamped ? server : null });
  };

  const ready = certificate.ready && !signed.locked && !certificate.checking;
  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.command.signCertificate')} closeLabel={t('common.action.close')}>
      <form
        className={shapeStyles.form}
        onSubmit={(event) => {
          event.preventDefault();
          // A window opened from this one (a look being set up) is not this form's to send.
          if (event.target !== event.currentTarget) return;
          if (settled) sign();
          else if (ready) void next();
        }}
      >
        {!settled ? (
          <>
            <p className={shapeStyles.lead}>{t('pdf-organizer.sign.stepCertificate')}</p>
            {signed.locked && (
              <p className={styles.problem} role="alert">
                {t('pdf-organizer.sign.locked')}
              </p>
            )}
            {!signed.locked && signed.count > 0 && (
              <p className={modified ? styles.problem : shapeStyles.lead}>{t(modified ? 'pdf-organizer.sign.signedAndChanged' : 'pdf-organizer.sign.signedBefore', { count: signed.count })}</p>
            )}

            <CertificatePicker choice={certificate} />

            <div className={shapeStyles.actions}>
              <Button onClick={onClose}>{t('common.action.cancel')}</Button>
              <Button type="submit" variant="primary" disabled={!ready}>
                {t('common.action.continue')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className={shapeStyles.lead}>{t('pdf-organizer.sign.signsAs', { name: settled.signer })}</p>
            {visible ? <LookPicker looks={looks} facts={facts} onPickPicture={onPickPicture} /> : <p className={shapeStyles.lead}>{t('pdf-organizer.sign.invisibleNote')}</p>}

            <details className={styles.more}>
              <summary>{t('pdf-organizer.sign.reasonAndPlace')}</summary>
              <p className={shapeStyles.lead}>{t('pdf-organizer.sign.reasonAndPlaceNote')}</p>
              <div className={styles.pair}>
                <label>
                  <span>{t('pdf-organizer.sign.reason')}</span>
                  <input type="text" className={styles.field} dir="auto" maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} />
                </label>
                <label>
                  <span>{t('pdf-organizer.sign.location')}</span>
                  <input type="text" className={styles.field} dir="auto" maxLength={200} value={location} onChange={(event) => setLocation(event.target.value)} />
                </label>
              </div>
            </details>

            <label className={shapeStyles.choice}>
              <input type="checkbox" checked={lock} onChange={(event) => setLock(event.target.checked)} />
              {t('pdf-organizer.sign.lock')}
            </label>
            <p className={shapeStyles.lead}>{t(lock ? 'pdf-organizer.sign.lockNote' : 'pdf-organizer.sign.noLockNote')}</p>

            <label className={shapeStyles.choice}>
              <input type="checkbox" checked={stamped} onChange={(event) => setStamped(event.target.checked)} />
              {t('pdf-organizer.sign.timeStamp')}
            </label>
            <p className={shapeStyles.lead}>{stamped ? t('pdf-organizer.sign.timeStampNote', { server: hostOf(server) }) : t('pdf-organizer.sign.noTimeStampNote')}</p>

            <div className={shapeStyles.actions}>
              <Button onClick={() => setSettled(null)}>{t('pdf-organizer.sign.back')}</Button>
              <Button type="submit" variant="primary">
                {t('pdf-organizer.sign.sign')}
              </Button>
            </div>
          </>
        )}
      </form>
    </Dialog>
  );
}

/** The name of the computer an address points to, which is what tells the user who is asked. */
export function hostOf(address: string): string {
  try {
    return new URL(address).hostname;
  } catch {
    return address;
  }
}
