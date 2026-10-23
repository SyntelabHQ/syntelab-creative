import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useEffect, useId, useMemo, useState } from 'react';
import type { PlanPage } from '../document/page-plan';
import { splitPlan } from '../document/split';
import type { SplitRule } from '../document/split';
import styles from './split-dialog.module.css';

export interface SplitDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly plan: readonly PlanPage[];
  /** The pages selected in "Organize pages": a new file can start at each of them. */
  readonly selected: ReadonlySet<number>;
  readonly busy: boolean;
  /** Writes the parts; resolves to true when the files are there. */
  readonly onSplit: (parts: readonly (readonly PlanPage[])[]) => Promise<boolean>;
}

type Mode = SplitRule['kind'];

/**
 * Asks how to cut the document into several files: every so many pages, or
 * at the selected pages. The document itself is not changed.
 */
export function SplitDialog({ open, onClose, plan, selected, busy, onSplit }: SplitDialogProps) {
  const t = useTranslation();
  const [mode, setMode] = useState<Mode>('every');
  const [every, setEvery] = useState(1);
  const groupName = useId();
  const everyId = useId();
  const canUseSelection = selected.size > 0;

  // Each time it opens: at the selection when there is one, else page by page.
  useEffect(() => {
    if (open) setMode(canUseSelection ? 'at' : 'every');
    // Only the moment of opening matters, not later changes of the selection.
  }, [open]);

  const parts = useMemo(
    () => splitPlan(plan, mode === 'at' ? { kind: 'at', starts: selected } : { kind: 'every', pages: every }),
    [plan, mode, selected, every],
  );
  const usable = parts.length > 1;

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.split.title')} closeLabel={t('common.action.close')}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (usable && !busy) void onSplit(parts).then((written) => written && onClose());
        }}
      >
        <p className={styles.lead}>{t('pdf-organizer.split.lead')}</p>

        <label className={styles.option}>
          <input type="radio" name={groupName} checked={mode === 'every'} onChange={() => setMode('every')} />
          <span className={styles.optionText}>
            <span id={everyId}>{t('pdf-organizer.split.every')}</span>
            <input
              aria-labelledby={everyId}
              type="number"
              className={styles.number}
              min={1}
              max={Math.max(1, plan.length - 1)}
              value={every}
              onFocus={() => setMode('every')}
              onChange={(event) => setEvery(Math.max(1, Math.floor(event.target.valueAsNumber) || 1))}
            />
          </span>
        </label>

        <label className={styles.option} data-disabled={!canUseSelection}>
          <input
            type="radio"
            name={groupName}
            checked={mode === 'at'}
            disabled={!canUseSelection}
            onChange={() => setMode('at')}
          />
          <span className={styles.optionText}>
            <span>{t('pdf-organizer.split.atSelection')}</span>
            <span className={styles.hint}>
              {canUseSelection
                ? t('pdf-organizer.organize.selected', { count: selected.size })
                : t('pdf-organizer.split.needSelection')}
            </span>
          </span>
        </label>

        <p className={styles.result} role="status">
          {usable ? t('pdf-organizer.split.result', { count: parts.length }) : t('pdf-organizer.split.onePart')}
        </p>

        <div className={styles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!usable || busy}>
            {t('pdf-organizer.split.choose')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
