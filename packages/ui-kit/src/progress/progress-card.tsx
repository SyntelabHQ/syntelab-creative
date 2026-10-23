import { useEffect, useState } from 'react';
import { Button } from '../button/button';
import styles from './progress-card.module.css';

export interface ProgressCardProps {
  /** What is being done, already translated. */
  readonly title: string;
  /** How much is done, from 0 to 1; null while nothing is known of how much there is to do. */
  readonly part: number | null;
  /** A line under the bar (how many of how many), already translated. */
  readonly stage: string;
  /** The name of the button that stops the work, already translated. */
  readonly stopLabel: string;
  /** Stop was pressed and the work has not ended yet. */
  readonly stopping: boolean;
  readonly onStop: () => void;
}

/** Work shorter than this is done before anybody would read how far it has got. */
const SHOWN_AFTER = 400;

/**
 * Lies over its parent (which must be positioned) while something long is
 * done there: how far the work has got, and a button that stops it. What is
 * under it cannot be touched meanwhile. The card itself shows only after a
 * moment, so short work does not flash it.
 */
export function ProgressCard({ title, part, stage, stopLabel, stopping, onStop }: ProgressCardProps) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // The Stop button takes the keys while the work lasts; when it is done they go back to where they were.
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const show = setTimeout(() => setShown(true), SHOWN_AFTER);
    return () => {
      clearTimeout(show);
      before?.focus({ preventScroll: true });
    };
  }, []);

  const percent = part === null ? undefined : Math.floor(Math.min(1, Math.max(0, part)) * 100);
  return (
    <div className={styles.veil} data-shown={shown}>
      {shown && (
        <div className={styles.card} role="alertdialog" aria-label={title} aria-busy="true">
          <div className={styles.head}>
            <span className={styles.title}>{title}</span>
            {percent !== undefined && <span className={styles.percent}>{percent}%</span>}
          </div>
          <div className={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} data-unknown={part === null}>
            <div className={styles.bar} style={percent === undefined ? undefined : { inlineSize: `${Math.min(1, Math.max(0, part ?? 0)) * 100}%` }} />
          </div>
          <div className={styles.foot}>
            <span className={styles.stage}>{stage}</span>
            <Button autoFocus disabled={stopping} onClick={onStop}>
              {stopLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
