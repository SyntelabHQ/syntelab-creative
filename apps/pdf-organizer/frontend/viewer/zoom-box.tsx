import { useI18n } from '@syntelab/i18n';
import { tooltip, useDismiss } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ZOOM, MIN_ZOOM } from './view-settings';
import { parseZoom, ZOOM_STEPS } from './zoom';
import styles from './zoom-box.module.css';

export interface ZoomBoxProps {
  /** The zoom in use right now. 1 = 100%. */
  readonly zoom: number;
  readonly onZoomChange: (zoom: number) => void;
}

/**
 * The zoom as a percentage. A click turns it into a field to type a value in,
 * with the usual steps listed under it.
 */
export function ZoomBox({ zoom, onZoomChange }: ZoomBoxProps) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const rootRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const percent = useMemo(() => new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 }), [language]);

  const close = () => setOpen(false);
  useDismiss(rootRef, open, close);
  useEffect(() => {
    if (!open) return;
    setTyped(String(Math.round(zoom * 1000) / 10));
    inputRef.current?.select();
    // Only the moment of opening matters, not later changes of the zoom.
  }, [open]);

  const choose = (value: number) => {
    onZoomChange(value);
    close();
  };

  return (
    <span ref={rootRef} className={styles.box}>
      {open ? (
        <input
          ref={inputRef}
          autoFocus
          type="text"
          inputMode="decimal"
          className={styles.input}
          value={typed}
          aria-label={t('pdf-organizer.viewer.zoomValue')}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const value = parseZoom(typed, MIN_ZOOM, MAX_ZOOM);
              if (value !== null) choose(value);
            } else if (event.key !== 'Escape') return;
            else close();
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      ) : (
        <button
          type="button"
          className={styles.value}
          aria-haspopup="listbox"
          {...tooltip(t('pdf-organizer.viewer.zoomValueHint'), 'bottom')}
          onClick={() => setOpen(true)}
        >
          {percent.format(zoom)}
        </button>
      )}
      {open && (
        <ul role="listbox" aria-label={t('pdf-organizer.viewer.zoomValue')} className={styles.steps}>
          {ZOOM_STEPS.map((step) => (
            <li key={step} role="option" aria-selected={Math.abs(step - zoom) < 0.0005} className={styles.step} onClick={() => choose(step)}>
              {percent.format(step)}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
