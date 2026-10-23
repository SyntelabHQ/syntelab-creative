import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog } from '@syntelab/ui-kit';
import shapeStyles from '../organize/shape-dialog.module.css';
import { hostOf } from './sign-dialog';
import styles from './signing.module.css';

export interface TimeStampDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The user goes on: the document gets its time stamp, as a new file. */
  readonly onStamp: () => void;
  /** The address of the time-stamping authority that is asked. */
  readonly server: string;
  /** The document has changes that are not in its file: they are written into the new file too. */
  readonly modified: boolean;
}

/**
 * Adding a time stamp of the whole document (a document time stamp, PAdES):
 * an authority confirms that the document was, exactly as it is, at this
 * moment. No certificate of the user is needed. Says what goes online first.
 */
export function TimeStampDialog({ open, onClose, onStamp, server, modified }: TimeStampDialogProps) {
  const t = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.command.timestamp')} closeLabel={t('common.action.close')}>
      <div className={shapeStyles.form}>
        <p className={shapeStyles.lead}>{t('pdf-organizer.timestamp.about')}</p>
        <p className={shapeStyles.lead}>{t('pdf-organizer.timestamp.online', { server: hostOf(server) })}</p>
        {modified && <p className={styles.problem}>{t('pdf-organizer.timestamp.changed')}</p>}
        <div className={shapeStyles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button
            variant="primary"
            autoFocus
            onClick={() => {
              onClose();
              onStamp();
            }}
          >
            {t('pdf-organizer.timestamp.add')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
