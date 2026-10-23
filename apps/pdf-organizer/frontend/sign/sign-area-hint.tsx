import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import shapeStyles from '../organize/shape-dialog.module.css';

export interface SignAreaHintProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The user goes on to drag the area of the signature on a page. */
  readonly onDrag: () => void;
  /** The user signs without the signature showing on any page. */
  readonly onInvisible: () => void;
  /** The user does not want this window again (it can be turned back on in Settings). */
  readonly onStopShowing: () => void;
}

/**
 * The first step of signing with a certificate: says that the area of the
 * signature is dragged on the page first, and the certificate and the look
 * are chosen after. Signing without anything on the pages starts here too.
 */
export function SignAreaHint({ open, onClose, onDrag, onInvisible, onStopShowing }: SignAreaHintProps) {
  const t = useTranslation();
  const [stop, setStop] = useState(false);
  useEffect(() => {
    if (open) setStop(false);
  }, [open]);

  const then = (act: () => void) => () => {
    if (stop) onStopShowing();
    onClose();
    act();
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.command.signCertificate')} closeLabel={t('common.action.close')}>
      <div className={shapeStyles.form}>
        <p className={shapeStyles.lead}>{t('pdf-organizer.sign.areaHint')}</p>
        <label className={shapeStyles.choice}>
          <input type="checkbox" checked={stop} onChange={(event) => setStop(event.target.checked)} />
          {t('pdf-organizer.sign.areaHintStop')}
        </label>
        <div className={shapeStyles.actions}>
          <Button onClick={then(onInvisible)}>{t('pdf-organizer.sign.invisible')}</Button>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button variant="primary" autoFocus onClick={then(onDrag)}>
            {t('common.action.continue')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
