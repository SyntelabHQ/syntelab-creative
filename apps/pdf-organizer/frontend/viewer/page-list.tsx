import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { addTurns, shownSizes } from '../document/page-plan';
import type { PlanPage, QuarterTurns } from '../document/page-plan';
import { turnBox } from '../find/find-hits';
import type { Hit } from '../find/find-hits';
import { PageImage } from './page-image';
import styles from './page-list.module.css';
import { buildRows, measureRows, rowOfPage } from './page-rows';
import { Rulers } from './rulers';
import { itemAt, layoutStrip } from './strip-layout';
import { useElementSize, useStripWindow } from './use-strip-window';
import { MAX_ZOOM, MIN_ZOOM, resolveZoom } from './view-settings';
import type { ViewSettings } from './view-settings';
import { PIXELS_PER_POINT, renderScale } from './zoom';

/** The shortest time between two page turns made with the wheel. */
const WHEEL_TURN_MILLISECONDS = 180;
/** How much one unit of wheel movement zooms: a notch of a mouse wheel (100 units) is about 16%. */
const ZOOM_PER_WHEEL_UNIT = 0.0015;
/** Pages are drawn sharp again this long after the zoom stopped changing; until then their pictures are stretched. */
const SHARPEN_AFTER_MILLISECONDS = 160;

/** Lines to measure and line things up by, over and around the pages. */
export interface Guides {
  readonly rulers: boolean;
  readonly grid: boolean;
  /** One unit of the rulers, in points, and its name as written on them. */
  readonly unitPoints: number;
  readonly unitName: string;
  /** From one line of the grid to the next, in points. */
  readonly gridPoints: number;
}

/** Space between rows, and between the two pages of a row. */
const PAGE_GAP = 16;
const PADDING = 24;

export interface PageListHandle {
  scrollToPage(page: number): void;
}

export interface PageListProps {
  readonly host: AppHost;
  /** The pages as the user has arranged them. */
  readonly pages: readonly PlanPage[];
  readonly view: ViewSettings;
  /** The page the viewer is on. With scrolling off, its row is the one shown. */
  readonly currentPage: number;
  readonly onCurrentPageChange: (page: number) => void;
  /** Reports the zoom actually used (fit modes depend on the window size). */
  readonly onZoomChange: (zoom: number) => void;
  /** Ctrl + mouse wheel (or a pinch): the zoom asked for. The place under the pointer stays where it is. */
  readonly onZoomTo: (zoom: number) => void;
  readonly guides?: Guides;
  /** With scrolling off: the user asked for the next (+1) or previous (-1) row. */
  readonly onStep: (direction: 1 | -1) => void;
  /** Places to mark on the pages ("Find in document"), in reading order. */
  readonly hits?: readonly Hit[];
  /** The one of `hits` the user is at. */
  readonly activeHit?: Hit | null;
  /**
   * Something to lay over a page (the fields of a form): gets the page, how
   * far it is turned as shown, and how many pixels a point is.
   */
  readonly renderOver?: (page: PlanPage, turn: QuarterTurns, pixelsPerPoint: number) => ReactNode;
  readonly ref?: Ref<PageListHandle>;
}

/**
 * The pages, in rows of one or two. Only the rows near the visible area exist
 * in the page at all, and only those get pictures, so a document of any
 * length costs the same.
 */
export function PageList(props: PageListProps) {
  const { host, pages, view, currentPage, onCurrentPageChange, onZoomChange, onZoomTo, onStep, hits, activeHit, renderOver, guides, ref } = props;
  const t = useTranslation();
  const pageCount = pages.length;
  const { pageLayout, coverPage, scrolling, rotation } = view;
  // Sizes as shown: each page with its own turn and the turn of the whole view.
  const pageSizes = useMemo(() => shownSizes(pages, rotation), [pages, rotation]);

  const allRows = useMemo(() => buildRows(pageCount, pageLayout, coverPage), [pageCount, pageLayout, coverPage]);
  const allSizes = useMemo(() => measureRows(allRows, pageSizes), [allRows, pageSizes]);

  // With scrolling off, the strip holds just the row of the current page.
  const currentRow = rowOfPage(currentPage, pageLayout, coverPage);
  const rows = useMemo(
    () => (scrolling ? allRows : allRows.slice(currentRow, currentRow + 1)),
    [scrolling, allRows, currentRow],
  );
  const rowSizes = useMemo(() => (scrolling ? allSizes : measureRows(rows, pageSizes)), [scrolling, allSizes, rows, pageSizes]);

  const hitsByPage = useMemo(() => {
    const byPage = new Map<number, Hit[]>();
    for (const hit of hits ?? []) byPage.set(hit.page, [...(byPage.get(hit.page) ?? []), hit]);
    return byPage;
  }, [hits]);

  /** A found place as a mark over the page's picture, whatever the zoom and the turn. */
  const mark = (hit: Hit, index: number) => {
    const page = pages[hit.page];
    if (!page) return null;
    const turn = addTurns(page.rotation, rotation);
    const box = turnBox(hit, page.width, page.height, turn);
    const [width, height] = turn % 180 === 0 ? [page.width, page.height] : [page.height, page.width];
    return (
      <span
        key={index}
        className={styles.hit}
        data-active={hit === activeHit}
        style={{
          left: `${(box.x / width) * 100}%`,
          top: `${(box.y / height) * 100}%`,
          width: `${(box.width / width) * 100}%`,
          height: `${(box.height / height) * 100}%`,
        }}
      />
    );
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const viewport = useElementSize(scrollRef);
  const viewportHeight = viewport.height;

  const zoom = resolveZoom(view, {
    availableWidth: viewport.width - PADDING * 2,
    availableHeight: viewport.height - PADDING * 2,
    // One row at a time is fitted exactly; a scrolling strip is fitted to its
    // largest row, so the zoom does not jump as pages of other sizes pass.
    widestRowPoints: rowSizes.widest,
    tallestRowPoints: rowSizes.tallest,
    fixedRowGap: pageLayout === 'two-page' ? PAGE_GAP : 0,
  });
  const pixelsPerPoint = PIXELS_PER_POINT * zoom;
  useEffect(() => onZoomChange(zoom), [zoom, onZoomChange]);
  /** The zoom asked for by the wheel, ahead of the one drawn while the wheel keeps turning. */
  const wantedZoom = useRef(zoom);
  wantedZoom.current = zoom;
  // While the zoom changes, the pictures already there are stretched; sharp ones are asked for when it rests.
  const [sharpZoom, setSharpZoom] = useState(zoom);
  useEffect(() => {
    const timer = setTimeout(() => setSharpZoom(zoom), SHARPEN_AFTER_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [zoom]);

  const layout = useMemo(
    () => layoutStrip(rowSizes.heights.map((height) => height * pixelsPerPoint), PAGE_GAP, PADDING),
    [rowSizes, pixelsPerPoint],
  );
  const widestRow = rowSizes.widest * pixelsPerPoint + (pageLayout === 'two-page' ? PAGE_GAP : 0);

  const { onScroll, mounted, settled, scrollTop } = useStripWindow(scrollRef, layout, viewportHeight, host.active);

  // While scrolling, the row under the middle of the window is the current one.
  const middleRow = itemAt(layout, scrollTop + viewportHeight / 2);
  const middlePage = rows[middleRow]?.[0] ?? 0;
  useEffect(() => {
    if (scrolling && viewportHeight > 0) onCurrentPageChange(middlePage);
  }, [scrolling, middlePage, viewportHeight, onCurrentPageChange]);

  // Where the top of the window is, as "this far into that page", so the same
  // spot can be found again when zoom or page layout change the strip.
  const anchor = useRef({ page: 0, fraction: 0 });
  const placedLayout = useRef(layout);
  /**
   * While zooming with the wheel: the place of the document under the
   * pointer (a row, how far down it, how far across from the middle in
   * points) and where on screen the pointer is, so that place can be put
   * back under it once the pages have their new size.
   */
  const underPointer = useRef<{ row: number; fraction: number; acrossPoints: number; x: number; y: number } | null>(null);
  const pixelsPerPointNow = useRef(pixelsPerPoint);
  const { active } = host;
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (placedLayout.current !== layout && underPointer.current) {
      placedLayout.current = layout;
      pixelsPerPointNow.current = pixelsPerPoint;
      const held = underPointer.current;
      underPointer.current = null;
      element.scrollTop = (layout.tops[held.row] ?? 0) + held.fraction * (layout.heights[held.row] ?? 0) - held.y;
      element.scrollLeft = element.scrollWidth / 2 + held.acrossPoints * pixelsPerPoint - held.x;
      return;
    }
    pixelsPerPointNow.current = pixelsPerPoint;
    if (placedLayout.current !== layout) {
      placedLayout.current = layout;
      const row = scrolling ? rowOfPage(anchor.current.page, pageLayout, coverPage) : 0;
      const fraction = scrolling ? anchor.current.fraction : 0;
      element.scrollTop = scrolling ? (layout.tops[row] ?? 0) + fraction * (layout.heights[row] ?? 0) : 0;
      return;
    }
    if (!scrolling) return;
    const row = itemAt(layout, scrollTop);
    const height = layout.heights[row] ?? 0;
    anchor.current = {
      page: rows[row]?.[0] ?? 0,
      fraction: height > 0 ? Math.max(0, (scrollTop - (layout.tops[row] ?? 0)) / height) : 0,
    };
  }, [layout, scrollTop, scrollRef, scrolling, rows, pageLayout, coverPage, pixelsPerPoint]);

  // A tab that was hidden may have lost its scroll position; put it back.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!active || !element || !scrolling) return;
    const row = rowOfPage(anchor.current.page, pageLayout, coverPage);
    element.scrollTop =
      (placedLayout.current.tops[row] ?? 0) + anchor.current.fraction * (placedLayout.current.heights[row] ?? 0);
    // Runs only when the tab comes back to the front.
  }, [active]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage(page) {
        const element = scrollRef.current;
        if (!element || !scrolling) return;
        const row = rowOfPage(page, pageLayout, coverPage);
        element.scrollTop = (layout.tops[row] ?? 0) - PAGE_GAP / 2;
      },
    }),
    [layout, scrollRef, scrolling, pageLayout, coverPage],
  );

  // With scrolling off, the keys that would scroll move between rows instead.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keys typed into a form field on the page belong to that field.
    if (event.target !== event.currentTarget) return;
    if (scrolling) return;
    if (event.key === 'PageDown' || event.key === 'ArrowRight') onStep(1);
    else if (event.key === 'PageUp' || event.key === 'ArrowLeft') onStep(-1);
    else return;
    event.preventDefault();
  };

  // The mouse wheel. With Ctrl held it zooms, like in other PDF programs.
  // With scrolling off it turns pages: a page taller than the window (zoomed
  // in) scrolls first, and turns when the wheel pushes past its edge.
  const lastWheelAction = useRef(0);
  const wheel = useRef((_event: WheelEvent) => {});
  wheel.current = (event) => {
    if (event.deltaY === 0) return;
    const direction = event.deltaY > 0 ? 1 : -1;
    const tooSoon = event.timeStamp - lastWheelAction.current < WHEEL_TURN_MILLISECONDS;

    if (event.ctrlKey) {
      // Otherwise the web view would zoom the whole interface.
      event.preventDefault();
      const element = scrollRef.current;
      if (!element) return;
      // Every bit of wheel movement zooms a little: smooth with a wheel, and with two fingers on a touchpad.
      const next = Math.min(Math.max(wantedZoom.current * Math.exp(-event.deltaY * ZOOM_PER_WHEEL_UNIT), MIN_ZOOM), MAX_ZOOM);
      if (next === wantedZoom.current) return;
      // Remembered once per stretch of zooming: later wheel events may come before the pages are redrawn.
      if (!underPointer.current) {
        const box = element.getBoundingClientRect();
        const [x, y] = [event.clientX - box.left, event.clientY - box.top];
        const placed = placedLayout.current;
        const row = itemAt(placed, element.scrollTop + y);
        const height = placed.heights[row] ?? 0;
        underPointer.current = {
          row,
          fraction: height > 0 ? (element.scrollTop + y - (placed.tops[row] ?? 0)) / height : 0,
          acrossPoints: (element.scrollLeft + x - element.scrollWidth / 2) / pixelsPerPointNow.current,
          x,
          y,
        };
      }
      wantedZoom.current = next;
      onZoomTo(next);
      return;
    }
    if (scrolling) return;
    const element = scrollRef.current;
    if (!element) return;
    const atEdge =
      direction === 1 ? element.scrollTop + element.clientHeight >= element.scrollHeight - 1 : element.scrollTop <= 0;
    if (!atEdge || tooSoon) return;
    lastWheelAction.current = event.timeStamp;
    onStep(direction);
  };
  // Listened to directly: only a non-passive listener may cancel the wheel.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => wheel.current(event);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [scrollRef]);

  const scale = renderScale(sharpZoom, window.devicePixelRatio);
  const gridPixels = (guides?.gridPoints ?? 0) * pixelsPerPoint;
  const pageUrl = (page: PlanPage | undefined) =>
    page
      ? host.resourceUrl(`page/${page.documentId}/${page.page}`, { scale, rotate: addTurns(page.rotation, rotation) })
      : '';
  const renderedRows = [];
  for (let row = mounted.first; row <= mounted.last; row++) {
    const showPictures = row >= settled.first && row <= settled.last;
    renderedRows.push(
      <div key={rows[row]?.[0] ?? row} className={styles.row} style={{ top: layout.tops[row], gap: PAGE_GAP }}>
        {(rows[row] ?? []).map((page) => (
          <div
            key={pages[page]?.key ?? page}
            role="img"
            aria-label={t('pdf-organizer.viewer.page', { page: page + 1 })}
            className={styles.page}
            data-page-index={page}
            style={{
              width: (pageSizes[page * 2] ?? 0) * pixelsPerPoint,
              height: (pageSizes[page * 2 + 1] ?? 0) * pixelsPerPoint,
            }}
          >
            {showPictures && <PageImage src={pageUrl(pages[page])} />}
            {guides?.grid && gridPixels >= 3 && <span className={styles.grid} style={{ backgroundSize: `${gridPixels}px ${gridPixels}px` }} />}
            {hitsByPage.get(page)?.map(mark)}
            {renderOver && pages[page] && renderOver(pages[page], addTurns(pages[page].rotation, rotation), pixelsPerPoint)}
          </div>
        ))}
      </div>,
    );
  }

  // Where the corner of the page in view is on screen: the rulers count from there.
  const [rulerOrigin, setRulerOrigin] = useState({ x: 0, y: 0 });
  const [scrolledAcross, setScrolledAcross] = useState(0);
  const rulersShown = guides?.rulers ?? false;
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!rulersShown || !element) return;
    const page = element.querySelector(`[data-page-index="${currentPage}"]`);
    if (!page) return;
    const [area, box] = [element.getBoundingClientRect(), page.getBoundingClientRect()];
    const next = { x: Math.round(box.left - area.left), y: Math.round(box.top - area.top) };
    setRulerOrigin((current) => (current.x === next.x && current.y === next.y ? current : next));
  }, [rulersShown, currentPage, layout, scrollTop, scrolledAcross, viewport.width, viewport.height, mounted.first, mounted.last, scrollRef]);

  return (
    <div className={styles.frame}>
      {rulersShown && guides && (
        <Rulers origin={rulerOrigin} width={viewport.width} height={viewport.height} unitPixels={guides.unitPoints * pixelsPerPoint} unitName={guides.unitName} />
      )}
    {/* PDF content is never mirrored, whatever the interface direction. */}
    <div
      ref={scrollRef}
      dir="ltr"
      className={styles.scroller}
      data-rulers={rulersShown}
      onScroll={(event) => {
        onScroll();
        if (rulersShown) setScrolledAcross(event.currentTarget.scrollLeft);
      }}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="region"
      aria-label={t('pdf-organizer.viewer.pages')}
    >
      <div className={styles.strip} style={{ height: layout.totalHeight, minWidth: widestRow + PADDING * 2 }}>
        {renderedRows}
      </div>
    </div>
    </div>
  );
}
