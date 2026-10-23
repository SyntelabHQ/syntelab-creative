import { useTranslation } from '@syntelab/i18n';
import { fileName } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { WAITING } from './use-batch-run';
import type { Outcome } from './use-batch-run';
import styles from './batch-view.module.css';

const STATE_ICONS: Record<Outcome['state'], string> = { waiting: 'file', working: 'rotate', done: 'circle-check', failed: 'triangle-exclamation' };

export interface FileListProps {
  readonly files: readonly string[];
  readonly outcomes: ReadonlyMap<string, Outcome>;
  /** The order matters (everything goes into one file): each file can be moved up or down. */
  readonly ordered: boolean;
  readonly disabled: boolean;
  readonly onMove: (index: number, by: number) => void;
  readonly onRemove: (path: string) => void;
  /** The file shown in the preview, and choosing another. */
  readonly selected: number;
  readonly onSelect: (index: number) => void;
}

/** The files of a run, one to a row, each with how it went. */
export function FileList({ files, outcomes, ordered, disabled, onMove, onRemove, selected, onSelect }: FileListProps) {
  const t = useTranslation();
  return (
    <ul className={styles.files}>
      {files.length === 0 && <li className={styles.none}>{t('pdf-organizer.batch.none')}</li>}
      {files.map((path, index) => {
        const outcome = outcomes.get(path) ?? WAITING;
        return (
          <li key={path} className={styles.file} data-state={outcome.state} data-selected={index === selected}>
            {ordered && <span className={styles.position}>{index + 1}</span>}
            <button type="button" className={styles.pick} aria-current={index === selected ? 'true' : undefined} onClick={() => onSelect(index)}>
            <span className={styles.state} data-state={outcome.state}>
              <Icon name={STATE_ICONS[outcome.state]} size={14} />
            </span>
            <span className={styles.texts}>
              <bdi className={styles.name} title={path}>
                {fileName(path)}
              </bdi>
              {outcome.state === 'working' && <span className={styles.said}>{t('pdf-organizer.batch.working')}</span>}
              {outcome.state === 'done' && <bdi className={styles.said}>{t('pdf-organizer.batch.written', { name: outcome.name })}</bdi>}
              {outcome.state === 'failed' && (
                <span className={styles.said} data-state="failed">
                  {t(outcome.problem)}
                </span>
              )}
            </span>
            </button>
            {ordered && (
              <>
                <button type="button" className={styles.remove} disabled={disabled || index === 0} aria-label={t('pdf-organizer.command.moveEarlier')} onClick={() => onMove(index, -1)}>
                  <Icon name="chevron-up" size={12} />
                </button>
                <button type="button" className={styles.remove} disabled={disabled || index === files.length - 1} aria-label={t('pdf-organizer.command.moveLater')} onClick={() => onMove(index, 1)}>
                  <Icon name="chevron-down" size={12} />
                </button>
              </>
            )}
            <button type="button" className={styles.remove} disabled={disabled} aria-label={t('pdf-organizer.batch.remove')} onClick={() => onRemove(path)}>
              <Icon name="xmark" size={12} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
