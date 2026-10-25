import { useTranslation } from '@syntelab/i18n';
import { Icon, IconButton } from '@syntelab/ui-kit';
import styles from './preview-zoom.module.css';

/** How large the preview is: the whole page in view, as wide as its column, or a share of the size on paper (1 = 100%). */
export type PreviewZoom = 'page' | 'width' | number;

/** The sizes the − and + buttons go through, as shares of the size on paper. */
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];
/** The sizes offered at a click, besides the two that fit. */
const QUICK = [0.5, 0.75, 1];
/** Pixels to a point at 100%: a point is 1/72 of an inch, a pixel 1/96. */
export const PIXELS_PER_POINT = 96 / 72;

/** Reads a size kept from before; anything else is the whole page. */
export function readPreviewZoom(kept: unknown): PreviewZoom {
  if (kept === 'page' || kept === 'width') return kept;
  return typeof kept === 'number' && STEPS.includes(kept) ? kept : 'page';
}

export interface PreviewZoomBarProps {
  readonly zoom: PreviewZoom;
  /** The size the page is shown at now, as a share of its size on paper: where − and + go on from. */
  readonly shown: number;
  readonly onChange: (zoom: PreviewZoom) => void;
}

/** Makes the preview smaller or larger: − and +, and the sizes used most, one click away. */
export function PreviewZoomBar({ zoom, shown, onChange }: PreviewZoomBarProps) {
  const t = useTranslation();
  const smaller = [...STEPS].reverse().find((step) => step < shown - 0.005);
  const larger = STEPS.find((step) => step > shown + 0.005);
  const choice = (value: PreviewZoom, label: string) => (
    <button key={String(value)} type="button" className={styles.choice} aria-pressed={zoom === value} onClick={() => onChange(value)}>
      {label}
    </button>
  );
  return (
    <div className={styles.bar} role="group" aria-label={t('pdf-organizer.viewer.zoomValue')}>
      <IconButton variant="ghost" aria-label={t('pdf-organizer.viewer.zoomOut')} disabled={smaller === undefined} onClick={() => smaller !== undefined && onChange(smaller)}>
        <Icon name="magnifying-glass-minus" size={14} />
      </IconButton>
      {choice('page', t('pdf-organizer.view.fitPage'))}
      {choice('width', t('pdf-organizer.view.fitWidth'))}
      {QUICK.map((value) => choice(value, `${Math.round(value * 100)}%`))}
      {typeof zoom === 'number' && !QUICK.includes(zoom) && (
        <button type="button" className={styles.choice} aria-pressed="true">
          {Math.round(zoom * 100)}%
        </button>
      )}
      <IconButton variant="ghost" aria-label={t('pdf-organizer.viewer.zoomIn')} disabled={larger === undefined} onClick={() => larger !== undefined && onChange(larger)}>
        <Icon name="magnifying-glass-plus" size={14} />
      </IconButton>
    </div>
  );
}
