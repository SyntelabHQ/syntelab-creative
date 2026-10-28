import type { Command } from '@syntelab/command-registry';
import { formatShortcut } from '@syntelab/command-registry';
import { useI18n } from '@syntelab/i18n';
import { Icon, MenuButton, tooltip, useDismiss } from '@syntelab/ui-kit';
import type { MenuItem, MenuSection } from '@syntelab/ui-kit';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import styles from './doc-rail.module.css';
import type { SideView } from './side-strip';
import { MAX_ZOOM, MIN_ZOOM } from './view-settings';
import { zoomIn, zoomOut } from './zoom';
import { ZoomPopup } from './zoom-popup';

export interface DocRailProps {
  /** The panel open beside the pages, if any. */
  readonly panel: SideView | null;
  readonly onPanelChange: (panel: SideView | null) => void;
  readonly onAttachedFiles: () => void;
  readonly onSignatures: () => void;
  /** How many of each the document has, shown as a small number on its button; none at 0. */
  readonly counts: { readonly bookmarks: number; readonly attached: number; readonly signatures: number };
  /** Zero-based. */
  readonly currentPage: number;
  readonly pageCount: number;
  readonly onPageChange: (page: number) => void;
  /** To the previous or next page (or pair of pages). */
  readonly onStep: (direction: 1 | -1) => void;
  /** Turns the pages a quarter clockwise, on screen only. */
  readonly onRotate: () => void;
  /** The commands of the document: the display menu shows those of the View menu that change how pages are shown. */
  readonly commands: readonly Command[];
  /** The zoom in use right now. 1 = 100%. */
  readonly zoom: number;
  readonly onZoomChange: (zoom: number) => void;
}

/** What the display menu offers, by sections, as ids of commands. */
const DISPLAY = [
  ['pdf-organizer.view.singlePage', 'pdf-organizer.view.twoPage', 'pdf-organizer.view.coverPage', 'pdf-organizer.view.scrolling'],
  ['pdf-organizer.zoom.actual', 'pdf-organizer.zoom.fit-page', 'pdf-organizer.zoom.fit-width', 'pdf-organizer.zoom.fit-height'],
  ['pdf-organizer.view.readMode', 'pdf-organizer.view.fullScreen'],
] as const;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The narrow strip on the far side of the pages: the panels of the document
 * (pages, bookmarks), its attached files and signatures, and at the bottom
 * where you are, how the pages are shown and how large.
 */
export function DocRail(props: DocRailProps) {
  const { panel, onPanelChange, onAttachedFiles, onSignatures, counts, currentPage, pageCount, onPageChange, onStep, onRotate, commands, zoom, onZoomChange } = props;
  const { t, language } = useI18n();
  const smaller = Math.max(zoomOut(zoom), MIN_ZOOM);
  const larger = Math.min(zoomIn(zoom), MAX_ZOOM);
  const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(zoom);
  const count = new Intl.NumberFormat(language, { notation: 'compact' });
  const [zoomShown, setZoomShown] = useState<DOMRect | null>(null);
  const zoomBox = useRef<HTMLDivElement>(null);
  const hideZoom = useCallback(() => setZoomShown(null), []);
  useDismiss(zoomBox, zoomShown !== null, hideZoom);

  const button = (label: string, icon: string, onClick: () => void, options: { pressed?: boolean; disabled?: boolean; count?: number } = {}) => {
    const many = options.count ?? 0;
    // The number is said with the name: "Bookmarks: 12".
    const named = many > 0 ? t('pdf-organizer.rail.counted', { name: label, count: many }) : label;
    return (
      <button type="button" className={styles.button} aria-label={named} aria-pressed={options.pressed} disabled={options.disabled} {...tooltip(named, 'start')} onClick={onClick}>
        <Icon name={icon} size={17} />
        {many > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {count.format(many)}
          </span>
        )}
      </button>
    );
  };
  // A window too low for all of it: the bottom groups go, the least needed first.
  const rail = useRef<HTMLElement>(null);
  const fits = useRoom(rail);
  const toggle = (view: SideView) => onPanelChange(panel === view ? null : view);

  const byId = new Map(commands.map((command) => [command.id, command]));
  const display: MenuSection[] = DISPLAY.map((ids, index) => {
    const items = ids.flatMap((id): MenuItem[] => {
      const command = byId.get(id);
      if (!command) return [];
      return [
        {
          id,
          label: t(command.labelKey),
          kind: command.kind ?? 'action',
          icon: command.icon,
          checked: command.checked,
          disabled: command.disabled,
          shortcut: command.shortcut && formatShortcut(command.shortcut, IS_MAC),
          onSelect: () => void command.run(),
        },
      ];
    });
    const group = byId.get(ids[0])?.groupKey;
    return { id: `display-${index}`, title: group && t(group), items };
  }).filter((section) => section.items.length > 0);

  return (
    <nav ref={rail} className={styles.rail} aria-label={t('pdf-organizer.side.label')}>
      {button(t('pdf-organizer.viewer.thumbnails'), 'copy-regular', () => toggle('thumbnails'), { pressed: panel === 'thumbnails' })}
      {button(t('pdf-organizer.command.bookmarks'), 'bookmark-regular', () => toggle('bookmarks'), { pressed: panel === 'bookmarks', count: counts.bookmarks })}
      {button(t('pdf-organizer.command.attachedFiles'), 'paperclip', onAttachedFiles, { count: counts.attached })}
      {button(t('pdf-organizer.command.verifySignatures'), 'circle-check-regular', onSignatures, { count: counts.signatures })}
      <span className={styles.space} />
      {fits.pages && (
        <>
          <PageBox currentPage={currentPage} pageCount={pageCount} onPageChange={onPageChange} />
          {button(t('pdf-organizer.rail.previousPage'), 'chevron-up', () => onStep(-1), { disabled: currentPage <= 0 })}
          {button(t('pdf-organizer.rail.nextPage'), 'chevron-down', () => onStep(1), { disabled: currentPage >= pageCount - 1 })}
        </>
      )}
      {fits.display && (
        <>
          <span className={styles.line} />
          {button(t('pdf-organizer.group.rotate'), 'rotate-right', onRotate)}
          <div className={styles.menu}>
            <MenuButton label={t('pdf-organizer.rail.display')} sections={display} opens="above" tooltipSide="start">
              <Icon name="book-open" size={17} />
            </MenuButton>
          </div>
        </>
      )}
      {fits.zoom && fits.pages && <span className={styles.line} />}
      {fits.zoom && (
        <>
          {button(t('pdf-organizer.viewer.zoomIn'), 'magnifying-glass-plus', () => onZoomChange(larger), { disabled: larger <= zoom })}
          <div ref={zoomBox} className={styles.zoomBox}>
            <button
              type="button"
              className={styles.zoom}
              aria-haspopup="dialog"
              aria-expanded={zoomShown !== null}
              {...(zoomShown ? {} : tooltip(t('pdf-organizer.rail.zoom'), 'start'))}
              onClick={(event) => setZoomShown(zoomShown ? null : event.currentTarget.getBoundingClientRect())}
            >
              {percent}
            </button>
            {zoomShown && <ZoomPopup anchor={zoomShown} zoom={zoom} onZoomChange={onZoomChange} />}
          </div>
          {button(t('pdf-organizer.viewer.zoomOut'), 'magnifying-glass-minus', () => onZoomChange(smaller), { disabled: smaller >= zoom })}
        </>
      )}
    </nav>
  );
}

/** Heights, in pixels, of the parts of the rail: its panel buttons, and each group at the bottom with the line over it. */
const HEIGHTS = { top: 176, pages: 126, display: 90, zoom: 116 } as const;

/** Which groups of the bottom of the rail fit its height. */
function useRoom(rail: RefObject<HTMLElement | null>): { readonly pages: boolean; readonly display: boolean; readonly zoom: boolean } {
  const [height, setHeight] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const element = rail.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [rail]);
  const { top, pages, display, zoom } = HEIGHTS;
  return { zoom: height >= top + zoom, pages: height >= top + zoom + pages, display: height >= top + zoom + pages + display };
}

interface PageBoxProps {
  readonly currentPage: number;
  readonly pageCount: number;
  readonly onPageChange: (page: number) => void;
}

/** The page in view, which can be typed over to go to another, and how many there are. */
function PageBox({ currentPage, pageCount, onPageChange }: PageBoxProps) {
  const { t } = useI18n();
  const [typed, setTyped] = useState<string | null>(null);
  /** Escape was pressed: leaving the box then goes nowhere. */
  const dropped = useRef(false);
  // Another page came into view: what was typed and not taken is dropped.
  useEffect(() => setTyped(null), [currentPage]);

  const go = () => {
    if (dropped.current) {
      dropped.current = false;
      return;
    }
    const page = Number.parseInt(typed ?? '', 10);
    if (Number.isFinite(page) && pageCount > 0) onPageChange(Math.min(Math.max(page, 1), pageCount) - 1);
    setTyped(null);
  };

  return (
    <div className={styles.pageBox}>
      <input
        type="text"
        inputMode="numeric"
        className={styles.pageInput}
        aria-label={t('pdf-organizer.rail.goToPage', { count: pageCount })}
        {...tooltip(t('pdf-organizer.rail.goToPage', { count: pageCount }), 'start')}
        value={typed ?? String(currentPage + 1)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setTyped(event.target.value.replace(/[^0-9]/g, ''))}
        onBlur={go}
        onKeyDown={(event) => {
          // The keys of the pages (arrows, Home, End) are not meant here.
          event.stopPropagation();
          if (event.key === 'Enter') event.currentTarget.blur();
          else if (event.key === 'Escape') {
            dropped.current = true;
            setTyped(null);
            event.currentTarget.blur();
          }
        }}
      />
      <span className={styles.total}>{pageCount}</span>
    </div>
  );
}
