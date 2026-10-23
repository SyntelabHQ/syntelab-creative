import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Dialog, Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useState } from 'react';
import type { PlanPage } from '../document/page-plan';
import { CLIP_COLOR } from '../marks/mark-shape';
import shapeStyles from '../organize/shape-dialog.module.css';
import styles from './attachments-dialog.module.css';

/** A file kept inside the document as it is on disk. */
interface AttachedFile {
  readonly name: string;
  /** In bytes. */
  readonly size: number;
}

export interface AttachmentsDialogProps {
  readonly host: AppHost;
  readonly open: boolean;
  readonly onClose: () => void;
  /** The document whose file is asked about. */
  readonly documentId: number | undefined;
  /** The pages as arranged now: the paper clips on them are files still to be attached. */
  readonly pages: readonly PlanPage[];
  /** Goes to a paper clip and selects it. */
  readonly onShow: (pageKey: string, markId: string) => void;
  /** Attaches another file. */
  readonly onAdd: () => void;
  /** The names of the files of the document that are taken out when it is saved. */
  readonly detached: readonly string[];
  /** Takes a file of the document out at the next save, or keeps it after all. */
  readonly onDetach: (name: string, detached: boolean) => void;
}

/**
 * The files of the document: those already inside its file, which can be
 * saved to the computer, and those the user attached since, which go in when
 * the document is saved.
 */
export function AttachmentsDialog({ host, open, onClose, documentId, pages, onShow, onAdd, detached, onDetach }: AttachmentsDialogProps) {
  const { t, language } = useI18n();
  const { invoke, pickSavePath } = host;
  const [inFile, setInFile] = useState<readonly AttachedFile[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open || documentId === undefined) return;
    let cancelled = false;
    setMessage(null);
    invoke<{ files: AttachedFile[] }>('attached_files', { documentId })
      .then(({ files }) => !cancelled && setInFile(files))
      // A file that cannot be asked has nothing to list.
      .catch(() => !cancelled && setInFile([]));
    return () => {
      cancelled = true;
    };
  }, [open, documentId, invoke]);

  const pending = pages.flatMap((page, index) => (page.marks ?? []).filter((mark) => mark.kind === 'attachment').map((mark) => ({ page, index, mark })));
  const number = useMemo(() => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }), [language]);
  const size = (bytes: number) =>
    bytes >= 1024 * 1024 ? t('pdf-organizer.properties.megabytes', { size: number.format(bytes / (1024 * 1024)) }) : t('pdf-organizer.properties.kilobytes', { size: number.format(Math.max(bytes / 1024, 0.1)) });

  const saveAs = async (file: AttachedFile) => {
    if (documentId === undefined) return;
    const dot = file.name.lastIndexOf('.');
    const destination = await pickSavePath({ typeName: t('pdf-organizer.attachments.fileType'), extension: dot > 0 ? file.name.slice(dot + 1) : '*', suggestedName: file.name });
    if (destination === null) return;
    try {
      await invoke('save_attached_file', { documentId, name: file.name, destination });
      setMessage(t('pdf-organizer.attachments.saved', { path: destination }));
    } catch {
      setMessage(t('pdf-organizer.attachments.failed'));
    }
  };

  const clip = (color: string) => (
    <span className={styles.clip} style={{ color }} aria-hidden="true">
      <svg viewBox="0 0 16 22" width="14" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M9.9 6.200V15.400C9.900 18.900 6.100 18.900 6.100 15.400V4.400C6.100 0.400 12.500 0.400 12.500 4.400V17.200C12.500 22 3.500 22 3.500 17.200V6.200" />
      </svg>
    </span>
  );

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.attachments.title')} closeLabel={t('common.action.close')}>
      <div className={shapeStyles.form}>
        {inFile.length === 0 && pending.length === 0 && <p className={shapeStyles.lead}>{t('pdf-organizer.attachments.none')}</p>}

        {inFile.length > 0 && (
          <section className={shapeStyles.field}>
            <h3 className={shapeStyles.legend}>{t('pdf-organizer.attachments.inFile')}</h3>
            <ul className={styles.list}>
              {inFile.map((file) => (
                <li key={file.name} className={styles.file}>
                  {clip(CLIP_COLOR)}
                  <span className={styles.facts} data-gone={detached.includes(file.name)}>
                    <bdi className={styles.name}>{file.name}</bdi>
                    <span className={styles.detail}>{detached.includes(file.name) ? t('pdf-organizer.attachments.removed') : size(file.size)}</span>
                  </span>
                  <Button onClick={() => void saveAs(file)}>
                    <Icon name="file-arrow-down" size={14} />
                    {t('pdf-organizer.attachments.saveAs')}
                  </Button>
                  <Button onClick={() => onDetach(file.name, !detached.includes(file.name))}>
                    <Icon name={detached.includes(file.name) ? 'arrow-rotate-left' : 'trash-can'} size={14} />
                    {t(detached.includes(file.name) ? 'pdf-organizer.attachments.keep' : 'pdf-organizer.attachments.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {pending.length > 0 && (
          <section className={shapeStyles.field}>
            <h3 className={shapeStyles.legend}>{t('pdf-organizer.attachments.pending')}</h3>
            <ul className={styles.list}>
              {pending.map(({ page, index, mark }) => (
                <li key={mark.id} className={styles.file}>
                  {clip(mark.stroke ?? CLIP_COLOR)}
                  <span className={styles.facts}>
                    <bdi className={styles.name}>{mark.name ?? ''}</bdi>
                    <span className={styles.detail}>
                      {t('pdf-organizer.attachments.page', { number: index + 1 })}
                      {mark.author ? ` · ${mark.author}` : ''}
                    </span>
                  </span>
                  <Button onClick={() => onShow(page.key, mark.id)}>{t('pdf-organizer.attachments.show')}</Button>
                </li>
              ))}
            </ul>
            <p className={shapeStyles.lead}>{t('pdf-organizer.attachments.pendingNote')}</p>
          </section>
        )}

        {message && (
          <p className={styles.message} role="status">
            {message}
          </p>
        )}

        <div className={shapeStyles.actions}>
          <Button onClick={onAdd}>
            <Icon name="file-circle-plus" size={14} />
            {t('pdf-organizer.attachments.add')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('common.action.close')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
