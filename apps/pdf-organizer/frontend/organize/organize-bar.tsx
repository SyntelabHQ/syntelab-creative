import { useTranslation } from '@syntelab/i18n';
import { TipLine } from '../tools/tip-line';
import { ThumbnailZoom } from './thumbnail-zoom';

export interface OrganizeBarProps {
  readonly selectedCount: number;
  /** How large the pages are shown. */
  readonly thumbnailSize: number;
  readonly onThumbnailSizeChange: (size: number) => void;
}

/** The line above the page grid, under the bar of Organize: how many pages are selected, how to select, and how large pages are shown. */
export function OrganizeBar({ selectedCount, thumbnailSize, onThumbnailSizeChange }: OrganizeBarProps) {
  const t = useTranslation();
  return (
    <TipLine lead={t('pdf-organizer.organize.selected', { count: selectedCount }) + '.'} end={<ThumbnailZoom size={thumbnailSize} onSizeChange={onThumbnailSizeChange} />}>
      {t('pdf-organizer.organize.help')}
    </TipLine>
  );
}
