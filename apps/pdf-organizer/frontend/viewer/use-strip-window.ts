import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { EMPTY_RANGE, itemsInWindow, rangesEqual } from './strip-layout';
import type { ItemRange, StripLayout } from './strip-layout';

/** How long scrolling must pause before pictures are requested. */
const SETTLE_MILLISECONDS = 120;

export interface ElementSize {
  readonly width: number;
  readonly height: number;
}

const NO_SIZE: ElementSize = { width: 0, height: 0 };

/**
 * The inner size of an element, kept up to date. A hidden element (a tab in
 * the background) has no size; the last real measurement is kept then.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): ElementSize {
  const [size, setSize] = useState(NO_SIZE);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      if (next.height === 0) return;
      setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export interface StripWindow {
  readonly onScroll: () => void;
  /** Items to keep in the page (as empty boxes). */
  readonly mounted: ItemRange;
  /**
   * Items whose pictures should be loaded: the mounted ones, once scrolling
   * has paused, so pages flying past during a fast scroll are never drawn.
   */
  readonly settled: ItemRange;
  readonly scrollTop: number;
}

/**
 * Tracks which part of a strip is on screen inside the scrolling element
 * `scrollRef`, whose height is `viewportHeight`.
 */
export function useStripWindow(
  scrollRef: RefObject<HTMLElement | null>,
  layout: StripLayout,
  viewportHeight: number,
  enabled: boolean,
): StripWindow {
  const [scrollTop, setScrollTop] = useState(0);
  const [settled, setSettled] = useState<ItemRange>(EMPTY_RANGE);
  const frame = useRef(0);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    // A hidden tab reports no scroll position; keep the last real one.
    if (element && element.clientHeight > 0) setScrollTop(element.scrollTop);
  }, [scrollRef]);

  // At most one measurement per frame while scrolling.
  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }, [measure]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // A new layout (zoom, page layout) can move the content without a scroll event.
  useEffect(measure, [layout, measure]);

  const visible = enabled ? itemsInWindow(layout, scrollTop, viewportHeight, viewportHeight) : EMPTY_RANGE;
  const { first, last } = visible;

  useEffect(() => {
    const range = { first, last };
    const timer = setTimeout(
      () => setSettled((current) => (rangesEqual(current, range) ? current : range)),
      SETTLE_MILLISECONDS,
    );
    return () => clearTimeout(timer);
  }, [first, last]);

  return { onScroll, mounted: visible, settled, scrollTop };
}
