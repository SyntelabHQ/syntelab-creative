import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Icon, IconButton } from '@syntelab/ui-kit';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { loadSettings, saveSettings, useOrganizerSettings } from '../settings/organizer-settings';
import { PageImage } from '../viewer/page-image';
import { MAX_THUMBNAIL_SIZE, MIN_THUMBNAIL_SIZE, sharpScale, stepThumbnailSize, THUMBNAIL_SIZE_STEP, wheelSteps } from './thumbnail-size';
import styles from './thumbnail-zoom.module.css';

/** Sharper pictures are asked for this long after the size stopped changing; until then the ones shown are stretched. */
const SHARPEN_AFTER_MILLISECONDS = 300;

export interface ThumbnailSize {
  /** The longest side of a page's picture, in CSS pixels. */
  readonly size: number;
  /** `size`, once it has stopped changing: the size pictures are drawn for. */
  readonly drawnSize: number;
  readonly onSizeChange: (size: number) => void;
  /** A step larger (1) or smaller (-1). */
  readonly onStep: (steps: number) => void;
}

/** The size of the thumbnails of a view, kept in the app's settings under `key`. */
export function useThumbnailSize(host: Pick<AppHost, 'loadData' | 'saveData'>, key: 'organizeThumbnailSize' | 'binderThumbnailSize'): ThumbnailSize {
  const size = useOrganizerSettings(host)[key];
  const [drawnSize, setDrawnSize] = useState(size);
  useEffect(() => {
    const timer = setTimeout(() => setDrawnSize(size), SHARPEN_AFTER_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [size]);
  const onSizeChange = useCallback(
    (next: number) => {
      // From the settings as they are at that moment, not as they were when this was drawn.
      const settings = loadSettings(host);
      if (settings[key] !== next) saveSettings(host, { ...settings, [key]: next });
    },
    [host, key],
  );
  const onStep = useCallback((steps: number) => onSizeChange(stepThumbnailSize(loadSettings(host)[key], steps)), [host, key, onSizeChange]);
  return { size, drawnSize, onSizeChange, onStep };
}

/** Ctrl + mouse wheel over `ref` makes the thumbnails larger or smaller, a step a notch. */
export function useCtrlWheelSteps(ref: RefObject<HTMLElement | null>, onStep: (steps: number) => void) {
  const latest = useRef(onStep);
  latest.current = onStep;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let rest = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      // Otherwise the web view would zoom the whole interface.
      event.preventDefault();
      const turned = wheelSteps(rest, event.deltaY);
      rest = turned.rest;
      if (turned.steps !== 0) latest.current(turned.steps);
    };
    // Listened to directly: only a non-passive listener may cancel the wheel.
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref]);
}

export interface ThumbnailZoomProps {
  readonly size: number;
  readonly onSizeChange: (size: number) => void;
}

/** A slider for the size of the thumbnails, between a button for smaller and one for larger. */
export function ThumbnailZoom({ size, onSizeChange }: ThumbnailZoomProps) {
  const t = useTranslation();
  return (
    <span className={styles.zoom}>
      <IconButton
        variant="ghost"
        className={styles.button}
        aria-label={t('pdf-organizer.thumbnailSize.smaller')}
        disabled={size <= MIN_THUMBNAIL_SIZE}
        onClick={() => onSizeChange(stepThumbnailSize(size, -1))}
      >
        <Icon name="magnifying-glass-minus" size={16} />
      </IconButton>
      <input
        type="range"
        className={styles.slider}
        min={MIN_THUMBNAIL_SIZE}
        max={MAX_THUMBNAIL_SIZE}
        step={THUMBNAIL_SIZE_STEP}
        value={size}
        aria-label={t('pdf-organizer.thumbnailSize.label')}
        onChange={(event) => onSizeChange(Number(event.target.value))}
      />
      <IconButton
        variant="ghost"
        className={styles.button}
        aria-label={t('pdf-organizer.thumbnailSize.larger')}
        disabled={size >= MAX_THUMBNAIL_SIZE}
        onClick={() => onSizeChange(stepThumbnailSize(size, 1))}
      >
        <Icon name="magnifying-glass-plus" size={16} />
      </IconButton>
    </span>
  );
}

export interface ThumbnailImageProps {
  readonly host: Pick<AppHost, 'resourceUrl'>;
  readonly documentId: number;
  /** Zero-based, in the file. */
  readonly page: number;
  /** The page's size in points, upright. */
  readonly width: number;
  readonly height: number;
  /** The size the picture is drawn for (see `ThumbnailSize.drawnSize`). */
  readonly drawnSize: number;
}

/**
 * The stored thumbnail of a page; shown large, a sharper picture of the page
 * is laid over it once drawn. The thumbnail is always there underneath, so
 * a picture the Rust side is slow to draw never leaves the place empty.
 */
export function ThumbnailImage({ host, documentId, page, width, height, drawnSize }: ThumbnailImageProps) {
  const scale = sharpScale(drawnSize, width, height, window.devicePixelRatio);
  return (
    <>
      <PageImage src={host.resourceUrl(`thumbnail/${documentId}/${page}`)} />
      {scale !== null && (
        <span className={styles.sharp}>
          <PageImage src={host.resourceUrl(`page/${documentId}/${page}`, { scale, rotate: 0 })} />
        </span>
      )}
    </>
  );
}
