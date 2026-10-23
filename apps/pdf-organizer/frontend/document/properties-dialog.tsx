import { useI18n } from '@syntelab/i18n';
import { Dialog } from '@syntelab/ui-kit';
import { useMemo } from 'react';
import type { DocumentFacts } from './document-facts';
import { parsePdfDate } from './document-facts';
import styles from './properties-dialog.module.css';

export interface PropertiesDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly fileName: string;
  /** Null while they are being read. */
  readonly facts: DocumentFacts | null;
  /** Pages of the file on disk, and of the document as arranged now. */
  readonly pageCount: number;
}

/** What the document says about itself: title, author, dates, size. Read only. */
export function PropertiesDialog({ open, onClose, fileName, facts, pageCount }: PropertiesDialogProps) {
  const { t, language } = useI18n();
  const formats = useMemo(
    () => ({
      date: new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short' }),
      size: new Intl.NumberFormat(language, { maximumFractionDigits: 1 }),
    }),
    [language],
  );

  const date = (written: string) => {
    const parsed = parsePdfDate(written);
    return parsed ? formats.date.format(parsed) : written;
  };
  const size = (bytes: number) =>
    bytes >= 1024 * 1024
      ? t('pdf-organizer.properties.megabytes', { size: formats.size.format(bytes / (1024 * 1024)) })
      : t('pdf-organizer.properties.kilobytes', { size: formats.size.format(bytes / 1024) });

  const rows: [string, string][] = facts
    ? [
        ['file', fileName],
        ['folder', facts.path.replace(/[\\/][^\\/]*$/, '')],
        ['size', size(facts.fileSize)],
        ['pages', String(pageCount)],
        ['title', facts.title],
        ['author', facts.author],
        ['subject', facts.subject],
        ['keywords', facts.keywords],
        ['created', date(facts.created)],
        ['modified', date(facts.modified)],
        ['creator', facts.creator],
        ['producer', facts.producer],
        ['format', facts.format],
      ]
    : [];

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.command.properties')} closeLabel={t('common.action.close')}>
      {facts ? (
        <dl className={styles.facts}>
          {rows
            .filter(([, value]) => value !== '')
            .map(([name, value]) => (
              <div key={name} className={styles.row}>
                <dt className={styles.name}>{t(`pdf-organizer.properties.${name}`)}</dt>
                <dd className={styles.value}>
                  <bdi>{value}</bdi>
                </dd>
              </div>
            ))}
        </dl>
      ) : (
        <p className={styles.reading}>{t('pdf-organizer.viewer.loading')}</p>
      )}
    </Dialog>
  );
}
