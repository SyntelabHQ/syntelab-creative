import { useI18n } from '@syntelab/i18n';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import styles from './doc-rail.module.css';
import { MAX_ZOOM, MIN_ZOOM } from './view-settings';
import { parseZoom } from './zoom';

export interface ZoomPopupProps {
  /** The button it opens from, in window coordinates: it stands beside it, on the pages' side. */
  readonly anchor: DOMRect;
  /** 1 = 100%. */
  readonly zoom: number;
  readonly onZoomChange: (zoom: number) => void;
}

/** Steps of the slider between the smallest zoom and the largest. */
const SLIDER_STEPS = 400;
const LOW = Math.log(MIN_ZOOM);
const HIGH = Math.log(MAX_ZOOM);

/** Where a zoom is on the slider: evenly by ratio, so 50% to 100% is as long as 100% to 200%. */
export function sliderOfZoom(zoom: number): number {
  return Math.round(((Math.log(Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM)) - LOW) / (HIGH - LOW)) * SLIDER_STEPS);
}

/** The zoom at a place of the slider, rounded to a whole percent. */
export function zoomOfSlider(step: number): number {
  const zoom = Math.exp(LOW + (step / SLIDER_STEPS) * (HIGH - LOW));
  return Math.min(Math.max(Math.round(zoom * 100) / 100, MIN_ZOOM), MAX_ZOOM);
}

/** The arrows move the slider or the caret, not the pages; Escape still closes the popup. */
function keepKeys(event: KeyboardEvent): void {
  if (event.key !== 'Escape') event.stopPropagation();
}

/** A slider and a box to type a zoom in, beside the zoom shown on the rail. */
export function ZoomPopup({ anchor, zoom, onZoomChange }: ZoomPopupProps) {
  const { t, language } = useI18n();
  const percent = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
  const [typed, setTyped] = useState<string | null>(null);
  const slider = useRef<HTMLInputElement>(null);
  useEffect(() => slider.current?.focus(), []);

  const take = () => {
    const wanted = typed === null ? null : parseZoom(typed, MIN_ZOOM, MAX_ZOOM);
    if (wanted !== null) onZoomChange(wanted);
    setTyped(null);
  };

  const rtl = document.documentElement.dir === 'rtl';
  const side = rtl ? { left: anchor.right + 10 } : { right: window.innerWidth - anchor.left + 10 };

  return (
    <div className={styles.zoomPopup} role="dialog" aria-label={t('pdf-organizer.rail.zoom')} style={{ top: anchor.top + anchor.height / 2, ...side }}>
      <input
        ref={slider}
        type="range"
        className={styles.slider}
        min={0}
        max={SLIDER_STEPS}
        value={sliderOfZoom(zoom)}
        aria-label={t('pdf-organizer.viewer.zoomValue')}
        aria-valuetext={`${percent.format(zoom * 100)}%`}
        onChange={(event) => onZoomChange(zoomOfSlider(Number(event.target.value)))}
        onKeyDown={keepKeys}
      />
      <label className={styles.typed}>
        <input
          type="text"
          inputMode="decimal"
          className={styles.typedInput}
          aria-label={t('pdf-organizer.viewer.zoomValue')}
          value={typed ?? percent.format(zoom * 100)}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={take}
          onKeyDown={(event) => {
            keepKeys(event);
            if (event.key === 'Enter') take();
          }}
        />
        %
      </label>
    </div>
  );
}
