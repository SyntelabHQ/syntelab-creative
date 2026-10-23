import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import shapeStyles from '../organize/shape-dialog.module.css';

export interface SignedSaveDialogProps {
  /** How many signatures the file has; the window is open while it is more than none. */
  readonly signatures: number;
  readonly onClose: () => void;
  /** Writes the document to a file of its own; the signed file stays as it is. */
  readonly onSaveAs: () => void;
  /** Writes over the signed file: its signatures go. */
  readonly onSave: () => void;
  /** The user does not want to be asked again (it can be turned back on in Settings). */
  readonly onStopAsking: () => void;
}

/**
 * Asked before "Save" writes a changed document over a file that is signed
 * with a certificate: the signatures cannot stay in a file that changed, so
 * saving as a new file is offered first.
 */
export function SignedSaveDialog({ signatures, onClose, onSaveAs, onSave, onStopAsking }: SignedSaveDialogProps) {
  const t = useTranslation();
  const open = signatures > 0;
  const [stop, setStop] = useState(false);
  useEffect(() => {
    if (open) setStop(false);
  }, [open]);

  const then = (act: () => void) => () => {
    if (stop) onStopAsking();
    onClose();
    act();
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.signedSave.title')} closeLabel={t('common.action.close')}>
      <div className={shapeStyles.form}>
        <p className={shapeStyles.lead}>{t('pdf-organizer.signedSave.lead', { count: signatures })}</p>
        <label className={shapeStyles.choice}>
          <input type="checkbox" checked={stop} onChange={(event) => setStop(event.target.checked)} />
          {t('pdf-organizer.signedSave.stopAsking')}
        </label>
        <div className={shapeStyles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button onClick={then(onSave)}>{t('pdf-organizer.signedSave.saveAnyway')}</Button>
          <Button variant="primary" onClick={then(onSaveAs)}>
            {t('pdf-organizer.signedSave.saveAs')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
