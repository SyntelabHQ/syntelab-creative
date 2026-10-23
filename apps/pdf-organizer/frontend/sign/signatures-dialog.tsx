import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Dialog, Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { parsePdfDate } from '../document/document-facts';
import shapeStyles from '../organize/shape-dialog.module.css';
import styles from './signing.module.css';

type Trust = 'trusted' | 'expired' | 'untrusted' | 'unknown';

/** A time stamp: an authority's word on when something was, as `signatures` describes it. */
interface TimeStamp {
  /** When, as PDF writes moments (in UTC). */
  readonly time: string;
  /** It is the authority's, and of what it stamps. */
  readonly intact: boolean;
  /** Who gave it; empty when that cannot be read. */
  readonly authority: string;
  readonly trust: Trust;
}

/** A signature of the file, or a time stamp of the whole document, as `signatures` describes it. */
interface Signature {
  readonly kind: 'signature' | 'timeStamp';
  readonly field: string;
  readonly signer: string;
  readonly issuer: string;
  readonly reason: string;
  readonly location: string;
  /** When it was made, as PDF writes moments. */
  readonly time: string;
  /** The signed bytes are as they were when it was made. */
  readonly intact: boolean;
  /** Nothing was added to the file after it. */
  readonly wholeFile: boolean;
  /** What was added after it is another signature, and nothing else. */
  readonly signedAfter: boolean;
  /** It closed the document: nothing may be changed after it, and no one else can sign. */
  readonly locks: boolean;
  readonly trust: Trust;
  /** The time stamp the signature keeps, if it has one. */
  readonly timeStamp: TimeStamp | null;
}

export interface SignaturesDialogProps {
  readonly host: AppHost;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly documentId: number | undefined;
  /** The document has changes that are not in its file: the check is of the file. */
  readonly modified: boolean;
  /** The signature clicked on a page (its place in the list), shown marked; null for none. */
  readonly shown?: number | null;
}

/** What asking the issuers online said of a certificate, or that it is being asked. */
type Revocation = 'checking' | 'good' | 'revoked' | 'unknown';

/** The signatures made with a certificate that the document's file has, each with what a check of it says. */
export function SignaturesDialog({ host, open, onClose, documentId, modified, shown = null }: SignaturesDialogProps) {
  const { t, language } = useI18n();
  const { invoke } = host;
  const [signatures, setSignatures] = useState<readonly Signature[] | null>(null);
  // By the signature's place in the list; a time stamp it keeps under its place with ':stamp'.
  const [revocations, setRevocations] = useState<ReadonlyMap<string, Revocation>>(new Map());
  const [notShown, setNotShown] = useState(false);
  const shownItem = useRef<HTMLLIElement | null>(null);
  const moment = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short' }), [language]);

  useEffect(() => {
    if (!open || documentId === undefined) return;
    let cancelled = false;
    setSignatures(null);
    setRevocations(new Map());
    setNotShown(false);
    invoke<{ signatures: Signature[] }>('signatures', { documentId })
      .then((answer) => !cancelled && setSignatures(answer.signatures))
      .catch(() => !cancelled && setSignatures([]));
    return () => {
      cancelled = true;
    };
  }, [open, documentId, invoke]);

  // The signature clicked on the page is brought into view once the list is there.
  useEffect(() => {
    if (signatures !== null) shownItem.current?.scrollIntoView?.({ block: 'nearest' });
  }, [signatures, shown]);

  const showCertificate = (index: number, timeStamp: boolean) => {
    setNotShown(false);
    invoke('show_certificate', { documentId, index, timeStamp }).catch(() => setNotShown(true));
  };

  const check = (index: number, timeStamp: boolean) => {
    const key = timeStamp ? `${index}:stamp` : `${index}`;
    const said = (revocation: Revocation) => setRevocations((known) => new Map(known).set(key, revocation));
    said('checking');
    invoke<{ status: Revocation }>('check_revocation', { documentId, index, timeStamp }).then(
      (answer) => said(answer.status),
      () => said('unknown'),
    );
  };

  /** The buttons under a signature, or a time stamp, and what asking online said. */
  const actions = (index: number, timeStamp: boolean, stampCertificate: boolean): ReactNode => {
    const revocation = revocations.get(timeStamp ? `${index}:stamp` : `${index}`);
    return (
      <>
        <div className={styles.signatureActions}>
          <Button onClick={() => showCertificate(index, timeStamp)}>{t('pdf-organizer.verify.showCertificate')}</Button>
          {stampCertificate && <Button onClick={() => showCertificate(index, true)}>{t('pdf-organizer.verify.showStampCertificate')}</Button>}
          <Button disabled={revocation === 'checking'} onClick={() => check(index, timeStamp)}>
            {t('pdf-organizer.verify.check')}
          </Button>
        </div>
        {revocation !== undefined && (
          <p className={styles.revocation} data-state={revocation} role="status">
            {t(revocation === 'checking' ? 'pdf-organizer.verify.checking' : `pdf-organizer.verify.revocation.${revocation}`)}
          </p>
        )}
      </>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.command.verifySignatures')} closeLabel={t('common.action.close')}>
      <div className={shapeStyles.form}>
        {signatures === null && <p className={shapeStyles.lead}>{t('pdf-organizer.verify.looking')}</p>}
        {signatures?.length === 0 && <p className={shapeStyles.lead}>{t('pdf-organizer.verify.none')}</p>}
        {signatures && signatures.length > 0 && (
          <ul className={styles.signatures}>
            {signatures.map((signature, index) => {
              const whole = signature.wholeFile || signature.signedAfter;
              const state = !signature.intact ? 'bad' : whole && signature.trust === 'trusted' ? 'good' : 'warning';
              const signed = parsePdfDate(signature.time);
              const stamp = signature.kind === 'signature' ? signature.timeStamp : null;
              const stamped = stamp ? parsePdfDate(stamp.time) : null;
              const marked = { 'data-shown': index === shown ? 'true' : undefined, ref: index === shown ? shownItem : undefined };
              if (signature.kind === 'timeStamp') {
                return (
                  <li key={index} className={styles.signature} {...marked}>
                    <span className={styles.mark} data-state={state}>
                      <Icon name={state === 'good' ? 'circle-check' : 'triangle-exclamation'} size={20} />
                    </span>
                    <div className={styles.says}>
                      <p className={styles.name}>
                        <bdi>{signature.signer === '' ? t('pdf-organizer.verify.timeStamp') : t('pdf-organizer.verify.timeStampBy', { authority: signature.signer })}</bdi>
                      </p>
                      {signed && <p className={styles.detail}>{t('pdf-organizer.verify.stampedOn', { moment: moment.format(signed) })}</p>}
                      <p>{t(!signature.intact ? 'pdf-organizer.verify.stampChanged' : signature.wholeFile ? 'pdf-organizer.verify.stampUnchanged' : signature.signedAfter ? 'pdf-organizer.verify.signedAfter' : 'pdf-organizer.verify.addedTo')}</p>
                      {signature.intact && <p>{t(`pdf-organizer.verify.stampTrust.${signature.trust}`)}</p>}
                      {signature.intact && signature.trust === 'untrusted' && <p className={styles.detail}>{t('pdf-organizer.verify.trustHint')}</p>}
                      {actions(index, false, false)}
                    </div>
                  </li>
                );
              }
              return (
                <li key={index} className={styles.signature} {...marked}>
                  <span className={styles.mark} data-state={state}>
                    <Icon name={state === 'good' ? 'circle-check' : 'triangle-exclamation'} size={20} />
                  </span>
                  <div className={styles.says}>
                    <p className={styles.name}>
                      <bdi>{signature.signer === '' ? t('pdf-organizer.verify.unknownSigner') : t('pdf-organizer.verify.signedBy', { signer: signature.signer })}</bdi>
                    </p>
                    {signature.issuer !== '' && <p className={styles.detail}>{t('pdf-organizer.sign.issuedBy', { issuer: signature.issuer })}</p>}
                    {signed && <p className={styles.detail}>{t('pdf-organizer.verify.signedOn', { moment: moment.format(signed) })}</p>}
                    {stamp && stamped && stamp.intact && (
                      <p className={styles.detail}>
                        {stamp.authority === '' ? t('pdf-organizer.verify.confirmedOn', { moment: moment.format(stamped) }) : t('pdf-organizer.verify.confirmedOnBy', { moment: moment.format(stamped), authority: stamp.authority })}
                      </p>
                    )}
                    {stamp && !stamp.intact && <p className={styles.detail}>{t('pdf-organizer.verify.stampBroken')}</p>}
                    {signature.reason !== '' && <p className={styles.detail}>{t('pdf-organizer.verify.reason', { reason: signature.reason })}</p>}
                    {signature.location !== '' && <p className={styles.detail}>{t('pdf-organizer.verify.location', { location: signature.location })}</p>}
                    <p>{t(!signature.intact ? 'pdf-organizer.verify.changed' : signature.wholeFile ? 'pdf-organizer.verify.unchanged' : signature.signedAfter ? 'pdf-organizer.verify.signedAfter' : 'pdf-organizer.verify.addedTo')}</p>
                    {signature.locks && <p>{t('pdf-organizer.verify.locks')}</p>}
                    {signature.intact && <p>{t(`pdf-organizer.verify.trust.${signature.trust}`)}</p>}
                    {signature.intact && signature.trust === 'untrusted' && <p className={styles.detail}>{t('pdf-organizer.verify.trustHint')}</p>}
                    {actions(index, false, stamp !== null)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {signatures && signatures.length > 0 && <p className={shapeStyles.lead}>{t('pdf-organizer.verify.offline')}</p>}
        {modified && <p className={shapeStyles.lead}>{t('pdf-organizer.verify.ofTheFile')}</p>}
        {notShown && (
          <p className={shapeStyles.lead} role="alert">
            {t('pdf-organizer.verify.certificateNotShown')}
          </p>
        )}
        <div className={shapeStyles.actions}>
          <Button variant="primary" onClick={onClose}>
            {t('common.action.close')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
