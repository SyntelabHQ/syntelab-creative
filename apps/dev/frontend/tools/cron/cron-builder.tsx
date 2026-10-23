import { useI18n } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import frame from '../../frame/tool-frame.module.css';
import { build, BUILT_FIELDS, RANGES, STARTS_WITH } from './cron-build';
import type { Built, BuiltField, BuiltName } from './cron-build';
import styles from './cron-builder.module.css';
import { monthName, weekdayName } from './cron-words';

export interface CronBuilderProps {
  /** The schedule that was built is to go into the input: in place of what is there, or as one more line. */
  readonly onUse: (expression: string, add: boolean) => void;
  /** A schedule to show in the builder, in place of what it holds: one that was typed, taken up to be changed. */
  readonly load?: Built;
}

const MODES = ['every', 'step', 'chosen'] as const;

/**
 * A schedule made by choosing: for each field, every value, every n-th, or
 * the values picked. What is chosen is written as cron writes it (five
 * fields, or six with seconds), and put into the input, where the tool
 * tells what it says, when it runs, and how the other forms write it.
 */
export function CronBuilder({ onUse, load }: CronBuilderProps) {
  const { t, language } = useI18n();
  // Not kept between uses, like what is typed into a tool.
  const [built, setBuilt] = useState<Built>(STARTS_WITH);
  useEffect(() => {
    if (load) setBuilt(load);
  }, [load]);
  const expression = build(built);
  const change = (name: BuiltName, field: Partial<BuiltField>) => setBuilt((before) => ({ ...before, [name]: { ...before[name], ...field } }));
  const label = (name: BuiltName, value: number) => (name === 'month' ? monthName(value, language).slice(0, 3) : name === 'dayOfWeek' ? weekdayName(value, language).slice(0, 3) : String(value));

  return (
    <section className={styles.builder} aria-label={t('dev.cron.builder')}>
      <div className={frame.paneHead}>
        <span className={frame.paneTitle}>{t('dev.cron.builder')}</span>
        <code className={styles.expression} dir="ltr">
          {expression}
        </code>
        <span className={frame.spring} />
        <button type="button" className={frame.action} onClick={() => onUse(expression, false)}>
          <Icon name="paste" size={13} />
          {t('dev.cron.builder.use')}
        </button>
        <button type="button" className={frame.action} onClick={() => onUse(expression, true)}>
          <Icon name="file-circle-plus" size={13} />
          {t('dev.cron.builder.add')}
        </button>
      </div>
      <div className={styles.fields}>
        <label className={styles.seconds}>
          <input type="checkbox" checked={built.withSeconds} onChange={(event) => setBuilt((before) => ({ ...before, withSeconds: event.target.checked }))} />
          <span>{t('dev.cron.builder.seconds')}</span>
        </label>
        {BUILT_FIELDS.filter((name) => name !== 'second' || built.withSeconds).map((name) => {
          const field = built[name];
          const [least, most] = RANGES[name];
          return (
            <div key={name} className={styles.field}>
              <span className={styles.name}>{t(`dev.cron.field.${name}`)}</span>
              <span role="radiogroup" aria-label={t(`dev.cron.field.${name}`)} className={frame.shows}>
                {MODES.map((mode) => (
                  <button key={mode} type="button" role="radio" aria-checked={field.mode === mode} onClick={() => change(name, { mode })}>
                    {t(`dev.cron.builder.mode.${mode}`)}
                  </button>
                ))}
              </span>
              {field.mode === 'step' && (
                <input type="number" className={styles.step} min={1} max={most - least + 1} value={field.step} aria-label={t('dev.cron.builder.mode.step')} onChange={(event) => Number.isInteger(event.target.valueAsNumber) && event.target.valueAsNumber >= 1 && change(name, { step: event.target.valueAsNumber })} />
              )}
              {field.mode === 'chosen' && (
                <span className={styles.values} data-wide={name === 'month' || name === 'dayOfWeek'}>
                  {Array.from({ length: most - least + 1 }, (_, index) => index + least).map((value) => {
                    const picked = field.chosen.includes(value);
                    return (
                      <button key={value} type="button" className={styles.value} aria-pressed={picked} onClick={() => change(name, { chosen: picked ? field.chosen.filter((known) => known !== value) : [...field.chosen, value] })}>
                        {label(name, value)}
                      </button>
                    );
                  })}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
