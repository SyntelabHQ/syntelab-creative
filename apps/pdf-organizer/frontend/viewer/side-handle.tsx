import { useTranslation } from '@syntelab/i18n';
import { tooltip } from '@syntelab/ui-kit';
import type { KeyboardEvent, PointerEvent } from 'react';
import styles from './side-handle.module.css';

export interface SideHandleProps {
  /** The panel's width now, in pixels. */
  readonly width: number;
  readonly min: number;
  readonly max: number;
  /** While dragged: the width to show. */
  readonly onResize: (width: number) => void;
  /** Let go (or a key pressed): the width to keep. */
  readonly onResized: (width: number) => void;
  /** Double click: back to this width. */
  readonly defaultWidth: number;
}

/** Room left for the pages whatever the panel's width, in pixels. */
const PAGES_ROOM = 240;

/**
 * The edge of a panel beside the pages, on the pages' side, dragged to make
 * the panel wider or narrower. Placed just before the panel.
 */
export function SideHandle({ width, min, max, onResize, onResized, defaultWidth }: SideHandleProps) {
  const t = useTranslation();
  const clamp = (wanted: number, body: DOMRect | undefined) => {
    const most = body ? Math.min(max, Math.max(min, body.width - PAGES_ROOM)) : max;
    return Math.round(Math.min(Math.max(wanted, min), most));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const panel = handle.parentElement?.nextElementSibling?.getBoundingClientRect();
    const body = handle.parentElement?.parentElement?.getBoundingClientRect();
    const rtl = getComputedStyle(handle).direction === 'rtl';
    const widthAt = (x: number) => clamp(panel ? (rtl ? x - panel.left : panel.right - x) : width, body);
    let last = width;
    const move = (moved: globalThis.PointerEvent) => {
      last = widthAt(moved.clientX);
      onResize(last);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      onResized(last);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const by = event.key === 'ArrowLeft' ? 20 : event.key === 'ArrowRight' ? -20 : 0;
    if (by === 0) return;
    event.preventDefault();
    event.stopPropagation();
    onResized(clamp(width + (rtl ? -by : by), event.currentTarget.parentElement?.parentElement?.getBoundingClientRect()));
  };

  return (
    <div className={styles.edge}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('pdf-organizer.side.resize')}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        className={styles.handle}
        {...tooltip(t('pdf-organizer.side.resize'), 'start')}
        onPointerDown={onPointerDown}
        onDoubleClick={() => onResized(defaultWidth)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
