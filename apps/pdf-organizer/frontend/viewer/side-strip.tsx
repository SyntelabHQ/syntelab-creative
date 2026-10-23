import { useTranslation } from '@syntelab/i18n';
import { Icon, IconButton, tooltip } from '@syntelab/ui-kit';
import type { ReactNode } from 'react';
import styles from './side-strip.module.css';

export type SideView = 'thumbnails' | 'bookmarks';

const VIEWS: readonly { view: SideView; icon: string; labelKey: string }[] = [
  { view: 'thumbnails', icon: 'images', labelKey: 'pdf-organizer.viewer.thumbnails' },
  { view: 'bookmarks', icon: 'bookmark', labelKey: 'pdf-organizer.command.bookmarks' },
];

export interface SideStripProps {
  readonly view: SideView;
  readonly onViewChange: (view: SideView) => void;
  /** Folded away: only a narrow bar with the button that brings it back. */
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  /** The content of the view that is shown. */
  readonly children: ReactNode;
}

/** The strip beside the pages: small pages, or the table of contents. It can be folded away to leave the pages more room. */
export function SideStrip({ view, onViewChange, collapsed, onCollapsedChange, children }: SideStripProps) {
  const t = useTranslation();

  if (collapsed) {
    return (
      <div className={styles.strip} data-collapsed="true">
        <IconButton variant="ghost" className={styles.fold} aria-label={t('pdf-organizer.side.expand')} aria-expanded={false} tooltipSide="end" onClick={() => onCollapsedChange(false)}>
          <Icon name="angles-right" size={12} />
        </IconButton>
        {VIEWS.map((option) => (
          <IconButton
            key={option.view}
            variant="ghost"
            className={styles.fold}
            aria-label={t(option.labelKey)}
            tooltipSide="end"
            onClick={() => {
              onViewChange(option.view);
              onCollapsedChange(false);
            }}
          >
            <Icon name={option.icon} size={14} />
          </IconButton>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.strip}>
      <div className={styles.head}>
        <div role="tablist" aria-label={t('pdf-organizer.side.label')} className={styles.tabs}>
          {VIEWS.map((option) => (
            <button
              key={option.view}
              type="button"
              role="tab"
              aria-selected={view === option.view}
              aria-label={t(option.labelKey)}
              className={styles.tab}
              {...tooltip(t(option.labelKey), 'bottom')}
              onClick={() => onViewChange(option.view)}
            >
              <Icon name={option.icon} size={15} />
            </button>
          ))}
        </div>
        <IconButton variant="ghost" className={styles.fold} aria-label={t('pdf-organizer.side.collapse')} aria-expanded onClick={() => onCollapsedChange(true)}>
          <Icon name="angles-left" size={12} />
        </IconButton>
      </div>
      {children}
    </div>
  );
}
