import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useMemo, useRef } from 'react';
import { addTurns, shownSizes } from '../document/page-plan';
import type { PlanPage } from '../document/page-plan';
import { MarkPreview } from '../marks/mark-preview';
import { PageImage } from './page-image';
import { layoutStrip } from './strip-layout';
import styles from './thumbnail-list.module.css';
import { useElementSize, useStripWindow } from './use-strip-window';
import type { ViewRotation } from './view-settings';

const THUMBNAIL_WIDTH = 112;
const LABEL_HEIGHT = 24;
const GAP = 12;
const PADDING = 12;

export interface ThumbnailListProps {
  readonly host: AppHost;
  /** The pages as the user has arranged them. */
  readonly pages: readonly PlanPage[];
  /** The view rotation: thumbnails turn with the pages. */
  readonly rotation: ViewRotation;
  readonly currentPage: number;
  readonly onSelect: (page: number) => void;
}

/** Small pictures of every page, on the side. Virtualized like the pages. */
export function ThumbnailList({ host, pages, rotation, currentPage, onSelect }: ThumbnailListProps) {
  const t = useTranslation();
  const pageCount = pages.length;
  // Sizes as shown: each page with its own turn and the turn of the whole view.
  const pageSizes = useMemo(() => shownSizes(pages, rotation), [pages, rotation]);

  const pictureHeights = useMemo(() => {
    const heights = new Float64Array(pageCount);
    for (let page = 0; page < pageCount; page++) {
      const width = pageSizes[page * 2] ?? 1;
      const height = pageSizes[page * 2 + 1] ?? 1;
      // Very tall pages are cut off rather than stretching the list.
      heights[page] = Math.min((THUMBNAIL_WIDTH * height) / Math.max(width, 1), THUMBNAIL_WIDTH * 2);
    }
    return heights;
  }, [pageSizes, pageCount]);

  const layout = useMemo(
    () => layoutStrip(pictureHeights.map((height) => height + LABEL_HEIGHT), GAP, PADDING),
    [pictureHeights],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportHeight = useElementSize(scrollRef).height;
  const { onScroll, mounted, settled } = useStripWindow(scrollRef, layout, viewportHeight, host.active);

  // Keep the current page's thumbnail in view while the pages scroll.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || viewportHeight === 0) return;
    const top = layout.tops[currentPage] ?? 0;
    const bottom = top + (layout.heights[currentPage] ?? 0);
    if (top < element.scrollTop) element.scrollTop = top - PADDING;
    else if (bottom > element.scrollTop + viewportHeight) element.scrollTop = bottom - viewportHeight + PADDING;
  }, [currentPage, layout, scrollRef, viewportHeight]);

  const items = [];
  for (let page = mounted.first; page <= mounted.last; page++) {
    const showPicture = page >= settled.first && page <= settled.last;
    const height = pictureHeights[page] ?? 0;
    const planned = pages[page];
    if (!planned) continue;
    const turn = addTurns(planned.rotation, rotation);
    const quarterTurn = turn % 180 !== 0;
    items.push(
      <li key={planned.key} className={styles.item} style={{ top: layout.tops[page] }}>
        <button
          type="button"
          className={styles.button}
          aria-label={t('pdf-organizer.viewer.page', { page: page + 1 })}
          aria-current={page === currentPage ? 'page' : undefined}
          onClick={() => onSelect(page)}
        >
          <span className={styles.picture} style={{ width: THUMBNAIL_WIDTH, height }}>
            {/* The stored thumbnail is upright; it is turned here, inside its frame. */}
            <span
              className={styles.turned}
              style={{
                width: quarterTurn ? height : THUMBNAIL_WIDTH,
                height: quarterTurn ? THUMBNAIL_WIDTH : height,
                rotate: `${turn}deg`,
              }}
            >
              {showPicture && <PageImage src={host.resourceUrl(`thumbnail/${planned.documentId}/${planned.page}`)} />}
              <MarkPreview marks={planned.marks} pageWidth={planned.width} pageHeight={planned.height} />
            </span>
          </span>
          <span className={styles.number} style={{ height: LABEL_HEIGHT }}>
            {page + 1}
          </span>
        </button>
      </li>,
    );
  }

  return (
    <div
      ref={scrollRef}
      role="navigation"
      className={styles.scroller}
      onScroll={onScroll}
      aria-label={t('pdf-organizer.viewer.thumbnails')}
    >
      <ol className={styles.strip} style={{ height: layout.totalHeight }}>
        {items}
      </ol>
    </div>
  );
}
