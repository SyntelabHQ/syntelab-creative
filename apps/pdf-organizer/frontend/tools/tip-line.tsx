import type { ReactNode } from 'react';
import styles from './tip-line.module.css';

export interface TipLineProps {
  /** Said first, in bold: what is chosen now (2 pages selected). */
  readonly lead?: string;
  /** What to do next with the tool that is open. */
  readonly children: ReactNode;
  /** A setting of the view, at the far end (the size of the pages). */
  readonly end?: ReactNode;
}

/** The line under the bar of an open tool: what to do with it, in a sentence. */
export function TipLine({ lead, children, end }: TipLineProps) {
  return (
    <div className={styles.tip} aria-live="polite">
      <p className={styles.text}>
        {lead && <b>{lead} </b>}
        {children}
      </p>
      {end}
    </div>
  );
}
