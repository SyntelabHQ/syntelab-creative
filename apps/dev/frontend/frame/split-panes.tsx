import { useTranslation } from '@syntelab/i18n';
import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { DEFAULT_SPLIT, readSplit } from './layout';
import type { ToolLayout } from './layout';
import styles from './tool-frame.module.css';

export interface SplitPanesProps {
  readonly layout: Pick<ToolLayout, 'sideBySide' | 'split' | 'onSplit'>;
  readonly first: ReactNode;
  readonly second: ReactNode;
  /** What lies over both panes (the card of long work). */
  readonly children?: ReactNode;
}

/** How far an arrow key moves the line between the panes. */
const STEP = 0.02;

/**
 * Two panes with a line between them that can be dragged: side by side, or
 * one over the other (always so where the tab is narrow). The line is moved
 * with the pointer or, when it has the keys, with the arrows; a double click
 * puts it back in the middle. Where it is left is told to the one who keeps it.
 */
export function SplitPanes({ layout, first, second, children }: SplitPanesProps) {
  const t = useTranslation();
  const panes = useRef<HTMLDivElement>(null);
  /** Where the line is while it is dragged; null when it is at rest. */
  const [dragged, setDragged] = useState<number | null>(null);
  const split = dragged ?? layout.split;

  /** The panes stand side by side right now (a narrow tab stacks them whatever was chosen). */
  const acrossNow = () => {
    const element = panes.current;
    return element !== null && getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length > 1;
  };

  const at = (event: PointerEvent): number => {
    const box = panes.current?.getBoundingClientRect();
    if (!box) return layout.split;
    if (!acrossNow()) return readSplit((event.clientY - box.top) / box.height);
    const part = (event.clientX - box.left) / box.width;
    // Read right to left, the first pane is on the right.
    return readSplit(getComputedStyle(panes.current as Element).direction === 'rtl' ? 1 - part : part);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const back = ['ArrowLeft', 'ArrowUp'].includes(event.key);
    const forth = ['ArrowRight', 'ArrowDown'].includes(event.key);
    if (!back && !forth) return;
    event.preventDefault();
    layout.onSplit(readSplit(layout.split + (forth ? STEP : -STEP)));
  };

  return (
    <div ref={panes} className={styles.panes} data-side-by-side={layout.sideBySide} data-dragging={dragged !== null} style={{ '--first': `${split}fr`, '--second': `${1 - split}fr` } as CSSProperties}>
      {first}
      <div
        role="separator"
        tabIndex={0}
        aria-label={t('dev.frame.splitter')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split * 100)}
        className={styles.splitter}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragged(at(event));
        }}
        onPointerMove={(event) => dragged !== null && setDragged(at(event))}
        onPointerUp={(event) => {
          if (dragged === null) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          layout.onSplit(dragged);
          setDragged(null);
        }}
        onPointerCancel={() => setDragged(null)}
        onDoubleClick={() => layout.onSplit(DEFAULT_SPLIT)}
        onKeyDown={onKeyDown}
      />
      {second}
      {children}
    </div>
  );
}
