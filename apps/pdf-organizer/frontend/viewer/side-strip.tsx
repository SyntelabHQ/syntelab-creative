import { useTranslation } from '@syntelab/i18n';
import { Icon, IconButton } from '@syntelab/ui-kit';
import type { ReactNode } from 'react';
import styles from './side-strip.module.css';

export type SideView = 'thumbnails' | 'bookmarks';

const TITLES: Record<SideView, string> = {
  thumbnails: 'pdf-organizer.viewer.thumbnails',
  bookmarks: 'pdf-organizer.command.bookmarks',
};

export interface SideStripProps {
  readonly view: SideView;
  readonly onClose: () => void;
  /** The content of the view that is shown. */
  readonly children: ReactNode;
}

/** The panel beside the pages, opened from the rail: small pages, or the table of contents. */
export function SideStrip({ view, onClose, children }: SideStripProps) {
  const t = useTranslation();
  return (
    <aside className={styles.strip} aria-label={t(TITLES[view])}>
      <div className={styles.head}>
        <h2 className={styles.title}>{t(TITLES[view])}</h2>
        <IconButton variant="ghost" className={styles.close} aria-label={t('common.action.close')} tooltipSide="bottom-end" onClick={onClose}>
          <Icon name="xmark" size={12} />
        </IconButton>
      </div>
      {children}
    </aside>
  );
}
