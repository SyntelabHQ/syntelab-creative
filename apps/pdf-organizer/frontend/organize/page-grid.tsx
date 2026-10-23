import { useI18n } from '@syntelab/i18n';
import { Icon, tooltip } from '@syntelab/ui-kit';
import type { AppHost } from '@syntelab/shell-api';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { addTurns } from '../document/page-plan';
import type { PlanPage, QuarterTurns } from '../document/page-plan';
import { MarkPreview } from '../marks/mark-preview';
import { layoutStrip } from '../viewer/strip-layout';
import { useElementSize, useStripWindow } from '../viewer/use-strip-window';
import styles from './page-grid.module.css';
import { ThumbnailImage, useCtrlWheelSteps } from './thumbnail-zoom';

const GAP = 12;
const PADDING = 20;
/** Around the picture of a cell: its border (2), padding (8 on the sides; 12 above, 8 below). */
const CELL_SIDES = 2 * 2 + 8 * 2;
/** Above and below the picture: the border, the padding, the gap (8) and the line of the page number (20, see the CSS). */
const CELL_ENDS = 2 * 2 + 12 + 8 + 8 + 20;

interface GridShape {
  readonly rowHeight: number;
  readonly columns: number;
}

/** Where to scroll to when the rows change shape, so the page at the top of the view stays there. */
export function scrollAfterResize(scrollTop: number, before: GridShape, after: GridShape): number {
  const top = Math.max(scrollTop - PADDING, 0);
  const row = Math.floor(top / (before.rowHeight + GAP));
  const into = Math.min((top - row * (before.rowHeight + GAP)) / before.rowHeight, 1);
  const newRow = Math.floor((row * before.columns) / after.columns);
  return newRow * (after.rowHeight + GAP) + into * after.rowHeight + (scrollTop > PADDING ? PADDING : scrollTop);
}

/** The size of one cell for pictures whose longest side is `pictureBox`: exactly what it holds. */
export function cellSize(pictureBox: number): { readonly width: number; readonly height: number } {
  return { width: pictureBox + CELL_SIDES, height: pictureBox + CELL_ENDS };
}

export interface PageGridProps {
  readonly host: AppHost;
  readonly pages: readonly PlanPage[];
  /** The turn of the whole view, added to each page's own. */
  readonly viewRotation: QuarterTurns;
  readonly selected: ReadonlySet<number>;
  readonly onSelectedChange: (selected: Set<number>) => void;
  /** The selected pages were dropped just before the page now at `before`. */
  readonly onMove: (before: number) => void;
  readonly onDelete: () => void;
  /** The quick buttons on one page: turn it, or take it out, whatever is selected. */
  readonly onRotatePage: (index: number, degrees: 90 | -90) => void;
  readonly onDeletePage: (index: number) => void;
  /** Ctrl+C, Ctrl+X, Ctrl+V on the selected pages. */
  readonly onCopy: () => void;
  readonly onCut: () => void;
  readonly onPaste: () => void;
  /** Double click: go and look at the page. */
  readonly onOpenPage: (page: number) => void;
  /** The longest side of a page's picture, in pixels; and the size the pictures are drawn for. */
  readonly pictureBox: number;
  readonly drawnSize: number;
  /** Ctrl + mouse wheel: a step larger (positive) or smaller. */
  readonly onSizeStep: (steps: number) => void;
}

interface DropPlace {
  readonly index: number;
  /** True: before the page at `index`. False: after it. */
  readonly before: boolean;
}

/**
 * Every page of the document as a small picture, in a grid: select pages,
 * drag them to another place. Only the rows on screen exist in the page.
 */
export function PageGrid(props: PageGridProps) {
  const { host, pages, viewRotation, selected, onSelectedChange, onMove, onDelete, onOpenPage, onRotatePage, onDeletePage, onCopy, onCut, onPaste, pictureBox, drawnSize, onSizeStep } = props;
  const { t, direction } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(scrollRef);
  /** Where a Shift+click range starts. */
  const anchor = useRef(0);
  const [drop, setDrop] = useState<DropPlace | null>(null);

  useCtrlWheelSteps(scrollRef, onSizeStep);

  const cell = cellSize(pictureBox);
  const columns = Math.max(1, Math.floor((size.width - PADDING * 2 + GAP) / (cell.width + GAP)));
  const rowCount = Math.ceil(pages.length / columns);
  const layout = useMemo(
    () => layoutStrip(new Float64Array(rowCount).fill(cell.height), GAP, PADDING),
    [rowCount, cell.height],
  );
  const { onScroll, mounted, settled } = useStripWindow(scrollRef, layout, size.height, host.active);

  // Larger or smaller pages, more or fewer in a row: the page at the top stays in view.
  const shownGrid = useRef({ rowHeight: cell.height, columns });
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const before = shownGrid.current;
    shownGrid.current = { rowHeight: cell.height, columns };
    if (!element || (before.rowHeight === cell.height && before.columns === columns)) return;
    element.scrollTop = scrollAfterResize(element.scrollTop, before, { rowHeight: cell.height, columns });
  }, [cell.height, columns]);

  const select = (index: number, event: MouseEvent) => {
    if (event.shiftKey) {
      const [from, to] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      const range = new Set(event.ctrlKey || event.metaKey ? selected : []);
      for (let page = from; page <= to; page++) range.add(page);
      onSelectedChange(range);
      return;
    }
    anchor.current = index;
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selected);
      if (!next.delete(index)) next.add(index);
      onSelectedChange(next);
    } else {
      onSelectedChange(new Set([index]));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && (key === 'c' || key === 'x' || key === 'v')) {
      event.preventDefault();
      if (key === 'v') onPaste();
      else if (selected.size > 0) (key === 'c' ? onCopy : onCut)();
    } else if ((event.ctrlKey || event.metaKey) && key === 'a') {
      event.preventDefault();
      onSelectedChange(new Set(pages.map((_, index) => index)));
    } else if (event.key === 'Delete' && selected.size > 0) {
      event.preventDefault();
      onDelete();
    } else if (event.key === 'Escape' && selected.size > 0) {
      onSelectedChange(new Set());
    }
  };

  const onDragStart = (index: number, event: DragEvent) => {
    // Dragging a page that is not selected moves just that page.
    if (!selected.has(index)) {
      anchor.current = index;
      onSelectedChange(new Set([index]));
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  };

  const onDragOver = (index: number, event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const firstHalf = event.clientX < box.left + box.width / 2;
    // "Before" is the left half when reading left to right, the right half otherwise.
    const before = direction === 'rtl' ? !firstHalf : firstHalf;
    setDrop((current) => (current?.index === index && current.before === before ? current : { index, before }));
  };

  // Past the pages (beside the last one, below them) the line stays where it
  // was shown, and letting go there moves the pages to it.
  const onEmptyDragOver = (event: DragEvent) => {
    if (!drop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (event: DragEvent) => {
    if (!drop) return;
    event.preventDefault();
    onMove(drop.before ? drop.index : drop.index + 1);
    setDrop(null);
  };

  const rows = [];
  for (let row = mounted.first; row <= mounted.last; row++) {
    const showPictures = row >= settled.first && row <= settled.last;
    const cells = [];
    for (let index = row * columns; index < Math.min((row + 1) * columns, pages.length); index++) {
      const page = pages[index];
      if (!page) continue;
      const turn = addTurns(page.rotation, viewRotation);
      const sideways = turn % 180 !== 0;
      // The page as shown, scaled to fit a square box.
      const [shownWidth, shownHeight] = sideways ? [page.height, page.width] : [page.width, page.height];
      const scale = pictureBox / Math.max(shownWidth, shownHeight, 1);
      const [width, height] = [shownWidth * scale, shownHeight * scale];
      const isSelected = selected.has(index);
      const quick = (labelKey: string, icon: string, run: () => void) => (
        <button type="button" className={styles.quickButton} aria-label={t(labelKey)} {...tooltip(t(labelKey), 'start')} onClick={run}>
          <Icon name={icon} size={15} />
        </button>
      );
      cells.push(
        <div key={page.key} className={styles.cellWrap}>
        <button
          type="button"
          className={styles.cell}
          style={{ width: cell.width, height: cell.height }}
          aria-label={t('pdf-organizer.viewer.page', { page: index + 1 })}
          aria-pressed={isSelected}
          data-drop={drop?.index === index ? (drop.before ? 'before' : 'after') : undefined}
          draggable
          onClick={(event) => select(index, event)}
          onDoubleClick={() => onOpenPage(index)}
          onDragStart={(event) => onDragStart(index, event)}
          onDragOver={(event) => onDragOver(index, event)}
          onDragEnd={() => setDrop(null)}
        >
          <span className={styles.box} style={{ height: pictureBox }}>
            <span className={styles.picture} style={{ width, height }}>
              {/* The stored thumbnail is upright; it is turned here, inside its frame. */}
              <span
                className={styles.turned}
                style={{ width: sideways ? height : width, height: sideways ? width : height, rotate: `${turn}deg` }}
              >
                {showPictures && (
                  <ThumbnailImage host={host} documentId={page.documentId} page={page.page} width={page.width} height={page.height} drawnSize={drawnSize} />
                )}
                <MarkPreview marks={page.marks} pageWidth={page.width} pageHeight={page.height} />
              </span>
            </span>
          </span>
          <span className={styles.number}>{index + 1}</span>
        </button>
        {/* Shown while the pointer is on the page: the things done most, one click away. */}
        <div className={styles.quick}>
          {quick('pdf-organizer.grid.rotateLeft', 'rotate-left', () => onRotatePage(index, -90))}
          {quick('pdf-organizer.grid.rotateRight', 'rotate-right', () => onRotatePage(index, 90))}
          {pages.length > 1 && quick('pdf-organizer.grid.delete', 'trash-can', () => onDeletePage(index))}
        </div>
        </div>,
      );
    }
    rows.push(
      <div key={row} className={styles.row} style={{ top: layout.tops[row], gap: GAP, paddingInline: PADDING }}>
        {cells}
      </div>,
    );
  }

  return (
    <div
      ref={scrollRef}
      role="group"
      aria-label={t('pdf-organizer.organize.grid')}
      className={styles.scroller}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onDragOver={onEmptyDragOver}
      onDrop={onDrop}
      onClick={(event) => {
        // A click on the empty background clears the selection.
        const target = event.target as HTMLElement;
        if (target === event.currentTarget || target.parentElement === event.currentTarget || target.parentElement?.parentElement === event.currentTarget) {
          onSelectedChange(new Set());
        }
      }}
    >
      <div className={styles.strip} style={{ height: layout.totalHeight }}>
        {rows}
      </div>
    </div>
  );
}
