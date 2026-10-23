import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import styles from './reopen-dialog.module.css';

export interface ReopenDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The encoding the file is read in now. */
  readonly current: string;
  readonly encodings: readonly string[];
  /** The text has changes that reading the file again would lose. */
  readonly changed: boolean;
  readonly onReopen: (encoding: string) => void;
}

/**
 * Reads the file again in another encoding, for a file whose letters came
 * out wrong (the encoding of an old file can only be guessed).
 */
export function ReopenDialog({ open, onClose, current, encodings, changed, onReopen }: ReopenDialogProps) {
  const t = useTranslation();
  const [encoding, setEncoding] = useState(current);
  useEffect(() => {
    if (open) setEncoding(current);
  }, [open, current]);

  return (
    <Dialog open={open} onClose={onClose} title={t('scribe.command.reopen')} closeLabel={t('common.action.close')}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onReopen(encoding);
        }}
      >
        <p className={styles.lead}>{t('scribe.reopen.lead')}</p>
        <label className={styles.row}>
          <span>{t('scribe.status.encoding')}</span>
          <select className={styles.select} value={encoding} onChange={(event) => setEncoding(event.target.value)}>
            {(encodings.includes(current) ? encodings : [current, ...encodings]).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {changed && (
          <p className={styles.warning} role="alert">
            {t('scribe.reopen.losesChanges')}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('scribe.reopen.read')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
