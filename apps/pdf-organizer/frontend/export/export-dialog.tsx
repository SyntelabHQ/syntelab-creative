import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useState } from 'react';
import shapeStyles from '../organize/shape-dialog.module.css';
import { EXPORT_FORMATS, EXPORT_GROUPS, isPictureFormat, RESOLUTIONS } from './export-formats';
import type { ExportChoice, ExportFormat } from './export-formats';
import styles from './export-dialog.module.css';

export interface ExportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly pageCount: number;
  readonly busy: boolean;
  /** Asks where to save and writes the document in that format. Resolves to true when it was written. */
  readonly onExport: (choice: ExportChoice) => Promise<boolean>;
}

/**
 * "Export": writes the document as it is now in another format, as pictures,
 * as text, or as a document for a word processor. The PDF itself stays as it is.
 */
export function ExportDialog({ open, onClose, pageCount, busy, onExport }: ExportDialogProps) {
  const t = useTranslation();
  const [format, setFormat] = useState<ExportFormat>('docx');
  const [resolution, setResolution] = useState<number>(150);
  const [quality, setQuality] = useState(88);
  const pictures = isPictureFormat(format);

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.export.title')} closeLabel={t('common.action.close')} wide>
      <form
        className={shapeStyles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void onExport({ format, resolution, quality }).then((done) => done && onClose());
        }}
      >
        <p className={shapeStyles.lead}>{t('pdf-organizer.export.lead')}</p>
        <div className={styles.columns}>
          <div role="radiogroup" aria-label={t('pdf-organizer.export.format')} className={styles.formats}>
            {EXPORT_GROUPS.map((group) => (
              <div key={group} className={styles.group}>
                <span className={styles.groupName}>{t(`pdf-organizer.export.group.${group}`)}</span>
                {EXPORT_FORMATS.filter((option) => option.group === group).map((option) => (
                  <button key={option.format} type="button" role="radio" aria-checked={format === option.format} className={styles.format} onClick={() => setFormat(option.format)}>
                    <span>{t(`pdf-organizer.export.format.${option.format}`)}</span>
                    <span className={styles.ending}>.{option.format}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className={styles.detail}>
            <h3 className={styles.heading}>{t(`pdf-organizer.export.format.${format}`)}</h3>
            <p className={styles.about}>{t(`pdf-organizer.export.about.${format}`)}</p>
            {pictures && (
              <label className={styles.row}>
                <span>{t('pdf-organizer.export.resolution')}</span>
                <select className={shapeStyles.select} value={resolution} onChange={(event) => setResolution(Number(event.target.value))}>
                  {RESOLUTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t('pdf-organizer.export.dotsPerInch', { count: option })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {pictures && (
              <p className={styles.explain}>
                {t('pdf-organizer.export.resolutionAbout')} {t(`pdf-organizer.export.resolutionAbout.${resolution}`)}
              </p>
            )}
            {format === 'jpg' && (
              <label className={styles.row}>
                <span>{t('pdf-organizer.export.quality')}</span>
                <span className={styles.slider}>
                  <input type="range" min={30} max={100} step={1} value={quality} onChange={(event) => setQuality(Number(event.target.value))} />
                  {quality}
                </span>
              </label>
            )}
            {format === 'jpg' && <p className={styles.explain}>{t('pdf-organizer.export.qualityAbout')}</p>}
            {(format === 'png' || format === 'jpg' || format === 'svg') && pageCount > 1 && <p className={styles.note}>{t('pdf-organizer.export.onePerPage', { count: pageCount })}</p>}
          </div>
        </div>
        <div className={shapeStyles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {t(busy ? 'pdf-organizer.create.working' : 'pdf-organizer.export.apply')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
