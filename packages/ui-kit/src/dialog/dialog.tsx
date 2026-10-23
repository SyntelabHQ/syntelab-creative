import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { IconButton } from '../button/button';
import { Icon } from '../icon/icon';
import styles from './dialog.module.css';

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  /** Name of the close button, already translated. */
  readonly closeLabel: string;
  /** For a window with two columns (a page beside its settings): wider than usual, where the program window allows. */
  readonly wide?: boolean;
  readonly children: ReactNode;
}

/**
 * A window over the program. Uses the browser's modal dialog: focus stays
 * inside and Escape closes it. A click beside it does not close it: what was
 * typed or chosen in it is not lost to a stray click.
 */
export function Dialog({ open, onClose, title, closeLabel, wide = false, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  /** True from when the window is closed because `open` became false until the browser reports that closing. */
  const closedByOwner = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      closedByOwner.current = false;
      dialog.showModal();
    }
    if (!open && dialog.open) {
      // The browser reports the closing a moment later; that report is not the user's doing.
      closedByOwner.current = true;
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-wide={wide}
      aria-labelledby={titleId}
      // The owner who closed it already knows; only the user's own closing (Escape) is reported.
      onClose={(event) => {
        // React passes the closing of a window opened from this one (through a portal) on to this one too: that is not this window closing.
        if (event.target !== ref.current) return;
        if (closedByOwner.current) closedByOwner.current = false;
        else onClose();
      }}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <IconButton variant="ghost" aria-label={closeLabel} tooltipSide="bottom-end" onClick={onClose}>
            <Icon name="xmark" size={18} />
          </IconButton>
        </header>
        <div className={styles.body}>{open && children}</div>
      </div>
    </dialog>
  );
}
