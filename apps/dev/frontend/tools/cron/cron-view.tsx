import { useI18n } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import frame from '../../frame/tool-frame.module.css';
import { read } from './cron-build';
import type { Built } from './cron-build';
import { cronWords, fromNow } from './cron-words';
import type { CronTold } from './cron-words';
import styles from './cron-view.module.css';

export interface CronViewProps {
  /** The schedules that were read; null while there are none to show. */
  readonly schedules: readonly CronTold[] | null;
  /** The runs before now are listed too. */
  readonly previous: boolean;
  /** A schedule written in another form is to go into the input, as one more line. */
  readonly onUse: (expression: string) => void;
  /** A schedule is to be taken up in the builder, to be changed there. */
  readonly onBuild: (built: Built) => void;
}

const FIELDS = ['second', 'minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek', 'year'] as const;
/** The forms a schedule is written in, in the order they are listed. */
const FORMS = ['crontab', 'withSeconds', 'quartz', 'aws', 'systemd'] as const;

/**
 * Schedules laid out to be read: what each says, in the language of the
 * program; its fields as they were written; when it next runs (and when it
 * last ran, when asked), with the day of the week and how far that is from
 * now; and how each of the other forms writes it, to copy or to try. The
 * times are those of the zone the schedule runs by.
 */
export function CronView({ schedules, previous, onUse, onBuild }: CronViewProps) {
  const { t, language } = useI18n();
  if (schedules === null || schedules.length === 0) return <p className={styles.note}>{t('dev.cron.viewEmpty')}</p>;
  const now = Date.now() / 1000;
  const copy = (text: string) => void navigator.clipboard.writeText(text).catch(() => {});

  return (
    <div className={styles.view}>
      {schedules.map((told, at) => {
        const when = (seconds: number) => new Intl.DateTimeFormat(language, { dateStyle: 'full', timeStyle: told.fields?.second ? 'medium' : 'short', timeZone: told.zone === 'local' ? undefined : told.zone }).format(new Date(seconds * 1000));
        const runs = (moments: readonly number[], written: readonly string[]) => (
          <ol className={styles.next}>
            {moments.map((seconds, index) => (
              <li key={seconds}>
                <span>{when(seconds)}</span>
                <span className={styles.far}>{fromNow(seconds, now, language)}</span>
                <code dir="ltr">{written[index]}</code>
              </li>
            ))}
          </ol>
        );
        // As cron writes it, when cron can: that is what the builder holds.
        const written = told.asOther?.crontab ?? told.asOther?.withSeconds ?? null;
        const built = written === null ? null : read(written);
        return (
          <article key={at} className={styles.schedule}>
            <span className={styles.head}>
              <code className={styles.expression} dir="ltr">
                {told.expression}
              </code>
              <span className={styles.form}>{t(`dev.cron.form.${told.form}`)}</span>
              {built !== null && (
                <button type="button" className={frame.action} onClick={() => onBuild(built)}>
                  <Icon name="sliders" size={12} />
                  {t('dev.cron.toBuilder')}
                </button>
              )}
            </span>
            <p className={styles.says}>{cronWords(told, t, language)}</p>
            {told.fields && (
              <dl className={styles.fields} dir="ltr">
                {FIELDS.map((name) => {
                  const field = told.fields?.[name];
                  return (
                    field && (
                      <div key={name} className={styles.field}>
                        <dd>{field.written}</dd>
                        <dt>{t(`dev.cron.field.${name}`)}</dt>
                      </div>
                    )
                  );
                })}
              </dl>
            )}
            {told.eitherDay && <p className={styles.warning}>{t('dev.cron.note.either')}</p>}
            {told.bothDays && <p className={styles.hint}>{t('dev.cron.note.both')}</p>}
            {told.form === 'aws' && <p className={styles.hint}>{t('dev.cron.note.aws')}</p>}
            {told.form === 'rate' ? (
              <p className={styles.hint}>{t('dev.cron.note.rate')}</p>
            ) : told.atStart ? (
              <p className={styles.hint}>{t('dev.cron.note.atStart')}</p>
            ) : told.next.length === 0 ? (
              <p className={styles.warning}>{t('dev.cron.note.never')}</p>
            ) : (
              <>
                <h3 className={styles.heading}>{t('dev.cron.next', { zone: told.zone ?? '' })}</h3>
                {runs(told.nextUnix, told.next)}
                {told.runsOut && <p className={styles.hint}>{t('dev.cron.note.few')}</p>}
              </>
            )}
            {previous && (told.previousUnix?.length ?? 0) > 0 && (
              <>
                <h3 className={styles.heading}>{t('dev.cron.previous', { zone: told.zone ?? '' })}</h3>
                {runs(told.previousUnix ?? [], told.previous ?? [])}
              </>
            )}
            {told.asOther && (
              <>
                <h3 className={styles.heading}>{t('dev.cron.other')}</h3>
                <ul className={styles.forms}>
                  {FORMS.map((form) => {
                    const written = told.asOther?.[form] ?? null;
                    return (
                      <li key={form}>
                        <span className={styles.formName}>{t(`dev.cron.form.${form}`)}</span>
                        {written === null ? (
                          <span className={styles.cannot}>{t('dev.cron.other.cannot')}</span>
                        ) : (
                          <>
                            <code dir="ltr">{written}</code>
                            <button type="button" className={frame.action} onClick={() => copy(written)}>
                              <Icon name="copy" size={12} />
                              {t('dev.frame.copy')}
                            </button>
                            <button type="button" className={frame.action} onClick={() => onUse(written)}>
                              <Icon name="file-circle-plus" size={12} />
                              {t('dev.cron.other.try')}
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {told.asOther.quartz !== null && <p className={styles.hint}>{t('dev.cron.other.numbering')}</p>}
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
