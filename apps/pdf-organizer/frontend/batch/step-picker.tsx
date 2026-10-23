import { useTranslation } from '@syntelab/i18n';
import { Button, Icon } from '@syntelab/ui-kit';
import type { ReactNode } from 'react';
import { BATCH_STEPS, has } from './batch-actions';
import type { BatchJob, BatchStep } from './batch-actions';
import styles from './batch-view.module.css';

const STEP_ICONS: Record<BatchStep, string> = { rotate: 'rotate-right', ocr: 'eye', header: 'table-columns', watermark: 'stamp', numbers: 'list-ol', compress: 'compress', sign: 'file-signature', export: 'file-export' };

export interface StepPickerProps {
  readonly job: BatchJob;
  /** The step whose choices are in view. */
  readonly shown: BatchStep;
  readonly onShow: (step: BatchStep) => void;
  readonly onToggle: (step: BatchStep, on: boolean) => void;
  readonly disabled: boolean;
  /** The choices of the step in view, drawn only while it is turned on. */
  readonly children: ReactNode;
}

/**
 * The things that can be done to each file: a short list to tick from on one
 * side, the choices of the one picked on the other. The list stays in view
 * however many choices a step has.
 */
export function StepPicker({ job, shown, onShow, onToggle, disabled, children }: StepPickerProps) {
  const t = useTranslation();
  const on = has(job, shown);
  return (
    <div className={styles.picker}>
      <ul className={styles.steps} aria-label={t('pdf-organizer.batch.action')}>
        {BATCH_STEPS.map((step) => {
          const ticked = has(job, step);
          return (
            <li key={step} className={styles.step} data-shown={step === shown} data-on={ticked}>
              <input
                type="checkbox"
                checked={ticked}
                disabled={disabled}
                aria-label={t(`pdf-organizer.batch.kind.${step}`)}
                onChange={(event) => {
                  onToggle(step, event.target.checked);
                  onShow(step);
                }}
              />
              <button type="button" className={styles.stepName} aria-current={step === shown} onClick={() => onShow(step)}>
                <Icon name={STEP_ICONS[step]} size={14} />
                <span>{t(`pdf-organizer.batch.kind.${step}`)}</span>
                {ticked && <span className={styles.order}>{job.steps.indexOf(step) + 1}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className={styles.stepDetails}>
        <h3 className={styles.stepTitle}>
          <Icon name={STEP_ICONS[shown]} size={16} />
          {t(`pdf-organizer.batch.kind.${shown}`)}
        </h3>
        <p className={styles.tip}>{t(`pdf-organizer.batch.kindNote.${shown}`)}</p>
        {on ? (
          children
        ) : (
          <span>
            <Button disabled={disabled} onClick={() => onToggle(shown, true)}>
              <Icon name="square-check" size={14} />
              {t('pdf-organizer.batch.addStep')}
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
