import { useI18n } from '@syntelab/i18n';
import { Icon, IconButton } from '@syntelab/ui-kit';
import { useEffect, useMemo, useState } from 'react';
import styles from './page-navigator.module.css';

export interface PageNavigatorProps {
  /** Zero-based. */
  readonly currentPage: number;
  readonly pageCount: number;
  readonly onGoToPage: (page: number) => void;
  readonly onStep: (direction: 1 | -1) => void;
}

/** Previous / next buttons and a box to type a page number into. */
export function PageNavigator({ currentPage, pageCount, onGoToPage, onStep }: PageNavigatorProps) {
  const { t, language } = useI18n();
  const numbers = useMemo(() => new Intl.NumberFormat(language), [language]);
  const [typed, setTyped] = useState(String(currentPage + 1));

  // Follow the document while the user is not typing.
  useEffect(() => setTyped(String(currentPage + 1)), [currentPage]);

  const commit = () => {
    const page = Number.parseInt(typed, 10);
    if (Number.isFinite(page)) onGoToPage(Math.min(Math.max(page, 1), pageCount) - 1);
    else setTyped(String(currentPage + 1));
  };

  return (
    <span className={styles.navigator}>
      <IconButton
        variant="ghost"
        aria-label={t('pdf-organizer.viewer.previousPage')}
        disabled={currentPage <= 0}
        onClick={() => onStep(-1)}
      >
        <Icon name="chevron-up" size={18} />
      </IconButton>
      <input
        className={styles.input}
        type="text"
        inputMode="numeric"
        aria-label={t('pdf-organizer.viewer.pageNumber')}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
      <span className={styles.count} aria-label={t('pdf-organizer.viewer.pageOf', { page: currentPage + 1, count: pageCount })}>
        / {numbers.format(pageCount)}
      </span>
      <IconButton
        variant="ghost"
        aria-label={t('pdf-organizer.viewer.nextPage')}
        disabled={currentPage >= pageCount - 1}
        onClick={() => onStep(1)}
      >
        <Icon name="chevron-down" size={18} />
      </IconButton>
    </span>
  );
}
