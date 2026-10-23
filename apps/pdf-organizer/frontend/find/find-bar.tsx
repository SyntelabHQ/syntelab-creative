import { useTranslation } from '@syntelab/i18n';
import { Icon, IconButton } from '@syntelab/ui-kit';
import { useEffect, useRef } from 'react';
import type { Find } from './use-find';
import styles from './find-bar.module.css';

export interface FindBarProps {
  readonly find: Find;
  /** Asked to go to the next (1) or previous (-1) place. */
  readonly onStep: (direction: 1 | -1) => void;
  /** Counts up each time "Find" is asked for again, to bring the cursor back. */
  readonly focusRequest: number;
}

/** The strip to type the text to find in, with how many places and the way between them. */
export function FindBar({ find, onStep, focusRequest }: FindBarProps) {
  const t = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const { hits, active, searching, limited } = find;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusRequest]);

  const asked = find.query.trim() !== '';
  let status = '';
  if (asked && hits.length > 0) {
    status =
      active >= 0
        ? t('pdf-organizer.find.position', { position: active + 1, count: hits.length })
        : t(limited ? 'pdf-organizer.find.countLimited' : 'pdf-organizer.find.count', { count: hits.length });
  } else if (asked) {
    status = t(searching ? 'pdf-organizer.find.searching' : 'pdf-organizer.find.none');
  }

  return (
    <div role="search" className={styles.bar}>
      <label className={styles.field}>
        <Icon name="magnifying-glass" size={14} />
        <input
          ref={input}
          type="text"
          className={styles.input}
          value={find.query}
          placeholder={t('pdf-organizer.find.placeholder')}
          aria-label={t('pdf-organizer.command.find')}
          onChange={(event) => find.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onStep(event.shiftKey ? -1 : 1);
            else if (event.key === 'Escape') find.close();
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      </label>
      <span className={styles.status} role="status" data-none={asked && !searching && hits.length === 0}>
        {status}
      </span>
      <IconButton variant="ghost" aria-label={t('pdf-organizer.find.previous')} disabled={hits.length === 0} onClick={() => onStep(-1)}>
        <Icon name="chevron-up" size={14} />
      </IconButton>
      <IconButton variant="ghost" aria-label={t('pdf-organizer.find.next')} disabled={hits.length === 0} onClick={() => onStep(1)}>
        <Icon name="chevron-down" size={14} />
      </IconButton>
      <IconButton variant="ghost" aria-label={t('pdf-organizer.find.close')} tooltipSide="bottom-end" onClick={find.close}>
        <Icon name="xmark" size={14} />
      </IconButton>
    </div>
  );
}
