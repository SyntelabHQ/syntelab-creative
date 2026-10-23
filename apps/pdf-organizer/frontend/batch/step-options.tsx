import { useTranslation } from '@syntelab/i18n';
import { NUMBER_FORMATS, NUMBER_PLACES, pageNumber } from '../document/page-numbers';
import type { NumberFormat, NumberWords } from '../document/page-numbers';
import type { Place } from '../document/page-shape';
import { EXPORT_FORMATS, isPictureFormat, RESOLUTIONS } from '../export/export-formats';
import type { ExportFormat } from '../export/export-formats';
import { WATERMARK_ANGLES } from '../insert/watermark-marks';
import type { WatermarkAngle } from '../insert/watermark-marks';
import { COMPRESS_LEVELS } from '../organize/compress-dialog';
import type { CompressLevel } from '../organize/compress-dialog';
import shapeStyles from '../organize/shape-dialog.module.css';
import type { BatchJob, BatchStep } from './batch-actions';
import styles from './batch-view.module.css';

const LEVELS = Object.keys(COMPRESS_LEVELS) as CompressLevel[];
const ANGLES = Object.keys(WATERMARK_ANGLES) as WatermarkAngle[];

export interface StepOptionsProps {
  /** The step whose choices are shown. */
  readonly step: BatchStep;
  readonly job: BatchJob;
  readonly onChange: (part: Partial<BatchJob>) => void;
  readonly words: NumberWords;
  readonly disabled: boolean;
}

/** The choices of one step of the job: which way to turn, how to number, how small, which format. Signing has its own (`SignOptions`). */
export function StepOptions({ step, job, onChange, words, disabled }: StepOptionsProps) {
  const t = useTranslation();
  if (step === 'compress') {
    return (
      <label className={styles.row}>
        <span>{t('pdf-organizer.batch.level')}</span>
        <select className={shapeStyles.select} value={job.level} disabled={disabled} onChange={(event) => onChange({ level: event.target.value as CompressLevel })}>
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {t(`pdf-organizer.compress.${level}`)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (step === 'export') {
    return (
      <>
        <label className={styles.row}>
          <span>{t('pdf-organizer.batch.format')}</span>
          <select className={shapeStyles.select} value={job.choice.format} disabled={disabled} onChange={(event) => onChange({ choice: { ...job.choice, format: event.target.value as ExportFormat } })}>
            {EXPORT_FORMATS.map(({ format }) => (
              <option key={format} value={format}>
                {t(`pdf-organizer.export.format.${format}`)}
              </option>
            ))}
          </select>
        </label>
        {isPictureFormat(job.choice.format) && (
          <label className={styles.row}>
            <span>{t('pdf-organizer.batch.resolution')}</span>
            <select className={shapeStyles.select} value={job.choice.resolution} disabled={disabled} onChange={(event) => onChange({ choice: { ...job.choice, resolution: Number(event.target.value) } })}>
              {RESOLUTIONS.map((resolution) => (
                <option key={resolution} value={resolution}>
                  {t('pdf-organizer.batch.dotsPerInch', { count: resolution })}
                </option>
              ))}
            </select>
          </label>
        )}
      </>
    );
  }
  if (step === 'rotate') {
    return (
      <label className={styles.row}>
        <span>{t('pdf-organizer.batch.turn')}</span>
        <select className={shapeStyles.select} value={job.turn} disabled={disabled} onChange={(event) => onChange({ turn: Number(event.target.value) as 90 | 180 | 270 })}>
          {[90, 180, 270].map((turn) => (
            <option key={turn} value={turn}>
              {t(`pdf-organizer.batch.turn.${turn}`)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (step === 'header') {
    return (
      <>
        <label className={styles.row}>
          <span>{t('pdf-organizer.batch.headerText')}</span>
          <input type="text" className={styles.field} dir="auto" maxLength={200} value={job.headerText} disabled={disabled} onChange={(event) => onChange({ headerText: event.target.value })} />
        </label>
        <label className={styles.row}>
          <span>{t('pdf-organizer.batch.footerText')}</span>
          <input type="text" className={styles.field} dir="auto" maxLength={200} value={job.footerText} disabled={disabled} onChange={(event) => onChange({ footerText: event.target.value })} />
        </label>
        <p className={shapeStyles.lead}>{t('pdf-organizer.batch.headerNote')}</p>
      </>
    );
  }
  if (step === 'watermark') {
    return (
      <>
        <label className={styles.row}>
          <span>{t('pdf-organizer.watermark.text')}</span>
          <input type="text" className={styles.field} dir="auto" maxLength={80} value={job.watermarkText} placeholder={t('pdf-organizer.batch.watermarkHint')} disabled={disabled} onChange={(event) => onChange({ watermarkText: event.target.value })} />
        </label>
        <label className={styles.row}>
          <span>{t('pdf-organizer.watermark.angle')}</span>
          <select className={shapeStyles.select} value={job.watermarkAngle} disabled={disabled} onChange={(event) => onChange({ watermarkAngle: event.target.value as WatermarkAngle })}>
            {ANGLES.map((angle) => (
              <option key={angle} value={angle}>
                {t(`pdf-organizer.watermark.angle.${angle}`)}
              </option>
            ))}
          </select>
        </label>
      </>
    );
  }
  if (step === 'numbers') {
    return (
      <>
        <label className={styles.row}>
          <span>{t('pdf-organizer.numbers.format')}</span>
          <select className={shapeStyles.select} value={job.numberFormat} disabled={disabled} onChange={(event) => onChange({ numberFormat: event.target.value as NumberFormat })}>
            {NUMBER_FORMATS.filter((format) => format !== 'custom').map((format) => (
              <option key={format} value={format}>
                {pageNumber(format, 1, 12, words)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.row}>
          <span>{t('pdf-organizer.numbers.place')}</span>
          <select className={shapeStyles.select} value={job.numberPlace} disabled={disabled} onChange={(event) => onChange({ numberPlace: event.target.value as Place })}>
            {NUMBER_PLACES.map((place) => (
              <option key={place} value={place}>
                {t(`pdf-organizer.numbers.${place}`)}
              </option>
            ))}
          </select>
        </label>
      </>
    );
  }
  return null;
}
