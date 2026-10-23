import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Icon, IconButton } from '@syntelab/ui-kit';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Mark } from '../marks/mark';
import { turnTransform } from '../marks/mark-layer';
import { MarkShape } from '../marks/mark-shape';
import { PageImage } from '../viewer/page-image';
import type { PlanPage } from './page-plan';
import styles from './page-preview.module.css';

export interface PagePreviewProps {
  readonly host: AppHost;
  readonly pages: readonly PlanPage[];
  /** The place (from 0) of the page shown. */
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  /** What to draw over the page, on top of what is already drawn on it: what the window is about to add. */
  readonly marks?: readonly Mark[];
  /** The page is shown as large as fits in this, in pixels. */
  readonly width?: number;
  readonly height?: number;
  /** Laid over the page, as large as it: something the user moves on it (the box of a signature). */
  readonly overlay?: ReactNode;
}

/**
 * A page of the document as it really is, with what a window is about to
 * put on it. The mouse wheel and the arrows go through the pages, to see how
 * it comes out on each.
 */
export function PagePreview({ host, pages, index, onIndexChange, marks = [], width = 300, height = 400, overlay }: PagePreviewProps) {
  const t = useTranslation();
  const stageRef = useRef<HTMLDivElement>(null);
  const page = pages[Math.min(Math.max(index, 0), pages.length - 1)];
  const step = (by: number) => onIndexChange(Math.min(Math.max(index + by, 0), pages.length - 1));
  const latestStep = useRef(step);
  latestStep.current = step;

  // Listened to directly: only a non-passive listener may keep the window behind from scrolling.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let last = 0;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || event.ctrlKey) return;
      event.preventDefault();
      if (event.timeStamp - last < 140) return;
      last = event.timeStamp;
      latestStep.current(event.deltaY > 0 ? 1 : -1);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  if (!page) return null;
  const sideways = page.rotation % 180 !== 0;
  const [shownWidth, shownHeight] = sideways ? [page.height, page.width] : [page.width, page.height];
  const pixels = Math.min(width / shownWidth, height / shownHeight);
  const scale = Math.min(3, Math.max(1, pixels * window.devicePixelRatio));

  return (
    <div className={styles.preview}>
      {/* PDF content is never mirrored: left is left. */}
      <div ref={stageRef} className={styles.stage} dir="ltr" style={{ width: shownWidth * pixels, height: shownHeight * pixels }}>
        <PageImage src={host.resourceUrl(`page/${page.documentId}/${page.page}`, { scale, rotate: page.rotation })} />
        <svg className={styles.marks} viewBox={`0 0 ${shownWidth} ${shownHeight}`} aria-hidden="true">
          <g transform={turnTransform(page.rotation, page.width, page.height)}>
            {[...(page.marks ?? []), ...marks].map((mark) => (
              <MarkShape key={mark.id} mark={mark} />
            ))}
          </g>
        </svg>
        {overlay}
      </div>
      {pages.length > 1 && (
        <div className={styles.pager}>
          <IconButton variant="ghost" aria-label={t('pdf-organizer.viewer.previousPage')} disabled={index <= 0} onClick={() => step(-1)}>
            <Icon name="chevron-up" size={14} />
          </IconButton>
          <span className={styles.where}>{t('pdf-organizer.preview.page', { page: index + 1, count: pages.length })}</span>
          <IconButton variant="ghost" aria-label={t('pdf-organizer.viewer.nextPage')} disabled={index >= pages.length - 1} onClick={() => step(1)}>
            <Icon name="chevron-down" size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
