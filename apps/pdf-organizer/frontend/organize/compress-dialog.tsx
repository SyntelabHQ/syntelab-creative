import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useId, useState } from 'react';
import styles from './shape-dialog.module.css';

/** How small the photographs are made: the longest side they keep, and the JPEG quality. */
export const COMPRESS_LEVELS = {
  light: { longestSide: 2000, quality: 82 },
  balanced: { longestSide: 1400, quality: 72 },
  strong: { longestSide: 900, quality: 60 },
} as const;
export type CompressLevel = keyof typeof COMPRESS_LEVELS;
const LEVELS = Object.keys(COMPRESS_LEVELS) as CompressLevel[];

export interface CompressDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly busy: boolean;
  /** Asks where to save and writes the smaller file. Resolves to true when it was written. */
  readonly onCompress: (level: CompressLevel) => Promise<boolean>;
}

/** Asks how much smaller the document should be made. It is saved as a new file. */
export function CompressDialog({ open, onClose, busy, onCompress }: CompressDialogProps) {
  const t = useTranslation();
  const [level, setLevel] = useState<CompressLevel>('balanced');
  const name = useId();

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.command.compress')} closeLabel={t('common.action.close')}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void onCompress(level).then((done) => done && onClose());
        }}
      >
        <p className={styles.lead}>{t('pdf-organizer.compress.lead')}</p>
        <fieldset className={styles.scope}>
          <legend className={styles.legend}>{t('pdf-organizer.compress.level')}</legend>
          {LEVELS.map((option) => (
            <label key={option} className={styles.choice}>
              <input type="radio" name={name} checked={level === option} onChange={() => setLevel(option)} />
              <span>
                <strong>{t(`pdf-organizer.compress.${option}`)}</strong>
                {' — '}
                {t(`pdf-organizer.compress.${option}Hint`)}
              </span>
            </label>
          ))}
        </fieldset>
        <div className={styles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {t('pdf-organizer.compress.apply')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
