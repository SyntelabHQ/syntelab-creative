import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
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
  /** Files dropped among the small pages, from outside the program: their pages go at place `at`. */
  readonly onDropFiles?: (files: File[], at: number) => void;
}

/** Small pictures of every page, on the side. Virtualized like the pages. */
export function ThumbnailList({ host, pages, rotation, currentPage, onSelect, onDropFiles }: ThumbnailListProps) {
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

  // Where dropped files would go: before or after a page, shown as a line in the gap.
  const [drop, setDrop] = useState<{ page: number; before: boolean } | null>(null);
  const takesFiles = (event: DragEvent) => onDropFiles !== undefined && event.dataTransfer.types.includes('Files');
  const onItemDragOver = (page: number, event: DragEvent) => {
    if (!takesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const box = event.currentTarget.getBoundingClientRect();
    const before = event.clientY < box.top + box.height / 2;
    setDrop((current) => (current?.page === page && current.before === before ? current : { page, before }));
  };
  const onListDragOver = (event: DragEvent) => {
    // Below the last page, the files go after it.
    if (!takesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onListDrop = (event: DragEvent) => {
    if (!takesFiles(event) || !onDropFiles) return;
    event.preventDefault();
    onDropFiles([...event.dataTransfer.files], drop ? (drop.before ? drop.page : drop.page + 1) : pageCount);
    setDrop(null);
  };

  const items = [];
  for (let page = mounted.first; page <= mounted.last; page++) {
    const showPicture = page >= settled.first && page <= settled.last;
    const height = pictureHeights[page] ?? 0;
    const planned = pages[page];
    if (!planned) continue;
    const turn = addTurns(planned.rotation, rotation);
    const quarterTurn = turn % 180 !== 0;
    items.push(
      <li
        key={planned.key}
        className={styles.item}
        style={{ top: layout.tops[page] }}
        data-drop={drop?.page === page ? (drop.before ? 'before' : 'after') : undefined}
        onDragOver={(event) => onItemDragOver(page, event)}
      >
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
      onDragOver={onListDragOver}
      onDrop={onListDrop}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
      }}
      aria-label={t('pdf-organizer.viewer.thumbnails')}
    >
      <ol className={styles.strip} style={{ height: layout.totalHeight }}>
        {items}
      </ol>
    </div>
  );
}
