import { useTranslation } from '@syntelab/i18n';
import { Button, Icon } from '@syntelab/ui-kit';
import styles from './organize-bar.module.css';
import { ThumbnailZoom } from './thumbnail-zoom';

export interface OrganizeBarProps {
  readonly selectedCount: number;
  readonly onDone: () => void;
  /** How large the pages are shown. */
  readonly thumbnailSize: number;
  readonly onThumbnailSizeChange: (size: number) => void;
}

/** The strip above the page grid: how many pages are selected, how to select, how large pages are shown, and the way back. */
export function OrganizeBar({ selectedCount, onDone, thumbnailSize, onThumbnailSizeChange }: OrganizeBarProps) {
  const t = useTranslation();

  return (
    <div className={styles.bar}>
      <span className={styles.count} aria-live="polite">
        {t('pdf-organizer.organize.selected', { count: selectedCount })}
      </span>
      <span className={styles.help}>{t('pdf-organizer.organize.help')}</span>
      <ThumbnailZoom size={thumbnailSize} onSizeChange={onThumbnailSizeChange} />
      <Button variant="outline" className={styles.done} onClick={onDone}>
        <Icon name="xmark" size={14} />
        {t('pdf-organizer.organize.done')}
      </Button>
    </div>
  );
}
