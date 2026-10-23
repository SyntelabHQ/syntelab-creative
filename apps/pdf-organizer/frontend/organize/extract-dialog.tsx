import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import styles from './shape-dialog.module.css';

/** More pages than this are not opened each in a tab of its own: use "Split document" for that. */
const MAX_SEPARATE_PAGES = 40;

export interface ExtractOptions {
  /** The pages leave the document they are taken from. */
  readonly removeFromSource: boolean;
  /** Each page becomes a document of its own. */
  readonly separate: boolean;
}

export interface ExtractDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** How many pages would be taken out. */
  readonly targetCount: number;
  /** How many pages the document has; it cannot lose all of them. */
  readonly pageCount: number;
  readonly busy: boolean;
  /** Takes the pages out into new tabs. Resolves to true when it was done. */
  readonly onExtract: (options: ExtractOptions) => Promise<boolean>;
}

/** Asks how the chosen pages are taken out. They open in new tabs, not saved anywhere yet. */
export function ExtractDialog({ open, onClose, targetCount, pageCount, busy, onExtract }: ExtractDialogProps) {
  const t = useTranslation();
  const [removeFromSource, setRemoveFromSource] = useState(false);
  const [separate, setSeparate] = useState(false);
  const canSeparate = targetCount > 1 && targetCount <= MAX_SEPARATE_PAGES;
  const canRemove = targetCount < pageCount;

  // Every extraction starts from the plain choice.
  useEffect(() => {
    if (!open) return;
    setRemoveFromSource(false);
    setSeparate(false);
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.command.extractPages')} closeLabel={t('common.action.close')}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          void onExtract({ removeFromSource: removeFromSource && canRemove, separate: separate && canSeparate }).then((done) => done && onClose());
        }}
      >
        <p className={styles.lead}>{t('pdf-organizer.extract.lead', { count: targetCount })}</p>
        <label className={styles.choice}>
          <input type="checkbox" checked={removeFromSource && canRemove} disabled={!canRemove} onChange={(event) => setRemoveFromSource(event.target.checked)} />
          <span>{t('pdf-organizer.extract.remove')}</span>
        </label>
        {targetCount > 1 && (
          <label className={styles.choice}>
            <input type="checkbox" checked={separate && canSeparate} disabled={!canSeparate} onChange={(event) => setSeparate(event.target.checked)} />
            <span>
              {t('pdf-organizer.extract.separate')}
              {!canSeparate && ` ${t('pdf-organizer.extract.separateTooMany', { count: MAX_SEPARATE_PAGES })}`}
            </span>
          </label>
        )}
        <div className={styles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy || targetCount === 0}>
            {t('pdf-organizer.extract.apply')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
