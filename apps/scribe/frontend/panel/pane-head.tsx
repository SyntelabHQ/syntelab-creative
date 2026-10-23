import { Icon, IconButton } from '@syntelab/ui-kit';
import type { ReactNode } from 'react';
import styles from './pane-head.module.css';

/** A small button of a pane's head: an icon, with its name as a tooltip. */
export interface PaneAction {
  readonly id: string;
  /** Name of a file in `assets/icons/`, without the extension. */
  readonly icon: string;
  /** Already translated. */
  readonly label: string;
  readonly onRun: () => void;
  readonly disabled?: boolean;
  /** For a switch: whether it is on. */
  readonly pressed?: boolean;
  /** Left out first when the pane is too narrow for all its buttons. */
  readonly minor?: boolean;
}

export interface PaneHeadProps {
  /** Already translated: what the pane holds ("Text", "Result"). */
  readonly title: string;
  /** What it is of: the name of the file, of the tool. */
  readonly of?: string;
  readonly actions: readonly PaneAction[];
  /** The line under the name: what is worth knowing of what the pane holds. */
  readonly facts?: ReactNode;
}

/**
 * The head of a pane: its name and its buttons on one line, a line of facts
 * under it. Both lines are of a fixed height, so two panes side by side
 * start their texts at the same height whatever their heads say.
 */
export function PaneHead({ title, of, actions, facts }: PaneHeadProps) {
  return (
    <header className={styles.head}>
      <div className={styles.names}>
        <h2 className={styles.title}>{title}</h2>
        {of && <bdi className={styles.of}>{of}</bdi>}
        <span className={styles.actions}>
          {actions.map((action) => (
            <IconButton key={action.id} variant="ghost" className={styles.action} data-minor={action.minor} aria-label={action.label} aria-pressed={action.pressed} tooltipSide="bottom-end" disabled={action.disabled} onClick={action.onRun}>
              <Icon name={action.icon} size={14} />
            </IconButton>
          ))}
        </span>
      </div>
      <div className={styles.facts}>{facts}</div>
    </header>
  );
}
