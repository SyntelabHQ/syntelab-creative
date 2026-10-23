import { useTranslation } from '@syntelab/i18n';
import { fileName } from '@syntelab/shell-api';
import { Button, Dialog } from '@syntelab/ui-kit';
import shapeStyles from '../organize/shape-dialog.module.css';
import styles from './batch-view.module.css';

/** How many of the files are named; the others are counted. */
const NAMED = 5;

export interface ReplaceDialogProps {
  /** The files a run would write over; the window is open while there are any. */
  readonly existing: readonly string[];
  /** Whether leaving them alone and doing the others is offered: not when the run writes one file only. */
  readonly canSkip: boolean;
  readonly onClose: () => void;
  /** Starts the run: `true` writes over them, `false` leaves them as they are. */
  readonly onChoose: (replace: boolean) => void;
}

/**
 * Asked before a run of batch processing writes results where files already
 * are (the files themselves, when their results go to their own folder under
 * the same names): replace them, leave them alone, or do nothing.
 */
export function ReplaceDialog({ existing, canSkip, onClose, onChoose }: ReplaceDialogProps) {
  const t = useTranslation();
  const count = existing.length;
  const choose = (replace: boolean) => () => {
    onClose();
    onChoose(replace);
  };

  return (
    <Dialog open={count > 0} onClose={onClose} title={t('pdf-organizer.batch.replace.title', { count })} closeLabel={t('common.action.close')}>
      <div className={shapeStyles.form}>
        <p className={shapeStyles.lead}>{t('pdf-organizer.batch.replace.lead', { count })}</p>
        <ul className={styles.replaced}>
          {existing.slice(0, NAMED).map((path) => (
            <li key={path}>
              <bdi dir="ltr" title={path}>
                {fileName(path)}
              </bdi>
            </li>
          ))}
          {count > NAMED && <li>{t('pdf-organizer.batch.replace.more', { count: count - NAMED })}</li>}
        </ul>
        <p className={shapeStyles.lead}>{t('pdf-organizer.batch.replace.safe')}</p>
        <div className={shapeStyles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          {canSkip && <Button onClick={choose(false)}>{t('pdf-organizer.batch.replace.skip', { count })}</Button>}
          <Button variant="primary" onClick={choose(true)}>
            {t('pdf-organizer.batch.replace.replace', { count })}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
