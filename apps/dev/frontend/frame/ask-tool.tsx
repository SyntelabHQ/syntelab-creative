import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useRef } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ToolActions } from './text-tool';
import styles from './tool-frame.module.css';
import { ToolProgress } from './tool-progress';

/** Something said in the line under the tool: a key of the translations, with what it needs. */
export interface Told {
  readonly key: string;
  readonly values?: Readonly<Record<string, string>>;
  readonly problem?: boolean;
}

export interface AskToolProps {
  readonly host: Pick<AppHost, 'invoke'>;
  /** What is asked, drawn in the line over the answer: boxes to type in and choices. Enter in a box asks. */
  readonly asked: ReactNode;
  /** More of what is asked, on a line of its own under the first. */
  readonly more?: ReactNode;
  /** What the button that asks says, already translated. */
  readonly runLabel: string;
  /** There is enough to ask with. */
  readonly ready: boolean;
  readonly onRun: () => void;
  /** What is being done, already translated, while it is; null when nothing is. */
  readonly working: string | null;
  /** How far the work has got is counted in things, not in bytes. */
  readonly counted?: boolean;
  readonly told: Told | null;
  /** Said at the start of the line under the tool, already translated. */
  readonly note: string;
  readonly onBurn: () => void;
  /** What the commands of the program do with the tool besides asking and burning. */
  readonly actions?: Partial<Pick<ToolActions, 'open' | 'save' | 'copy'>>;
  readonly onActions: (actions: ToolActions | null) => void;
  /** The answer. */
  readonly children: ReactNode;
}

/**
 * The frame of a tool that asks something of the world outside and shows
 * the answer (a request to a server, a question to a name server): what is
 * asked in a line, a button that asks, the answer under it, the card of
 * work with its Stop while the answer is awaited, and the line with Burn.
 */
export function AskTool({ host, asked, more, runLabel, ready, onRun, working, counted, told, note, onBurn, actions, onActions, children }: AskToolProps) {
  const { t } = useI18n();
  // The commands of the program reach what these do now, not what they did when they were made.
  const latest = useRef({ onRun, onBurn, actions, ready });
  latest.current = { onRun, onBurn, actions, ready };
  useEffect(() => {
    onActions({
      run: () => latest.current.ready && latest.current.onRun(),
      open: () => latest.current.actions?.open?.(),
      save: () => latest.current.actions?.save?.(),
      copy: () => latest.current.actions?.copy?.(),
      burn: () => latest.current.onBurn(),
    });
    return () => onActions(null);
  }, [onActions]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) onRun();
  };

  return (
    <>
      <form className={styles.options} onSubmit={submit}>
        {asked}
        <span className={styles.spring} />
        <button type="submit" className={styles.run} disabled={!ready} data-tooltip={t('dev.hint.run')}>
          <Icon name="bolt" size={13} />
          {runLabel}
        </button>
      </form>
      {more && <div className={styles.options}>{more}</div>}
      <section className={styles.pane} aria-label={t('dev.frame.output')} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {children}
        {working !== null && <ToolProgress host={host} title={working} counted={counted} />}
      </section>
      <div className={styles.status} role="status">
        <span>{note}</span>
        <span className={styles.spring} />
        {told && (
          <span className={styles.last} data-problem={told.problem === true}>
            {t(told.key, told.values)}
          </span>
        )}
        <button type="button" className={styles.burn} data-tooltip={t('dev.hint.burn')} onClick={onBurn}>
          <Icon name="trash-can" size={12} />
          {t('dev.frame.burn')}
        </button>
      </div>
    </>
  );
}
