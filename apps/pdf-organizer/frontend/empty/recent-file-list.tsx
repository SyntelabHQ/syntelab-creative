import { useI18n } from '@syntelab/i18n';
import { fileName, folderOf } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useState } from 'react';
import { clearRecentFiles, loadRecentFiles } from '../document/recent-files';
import styles from './recent-file-list.module.css';

export interface RecentFileListProps {
  readonly host: AppHost;
  readonly onOpen: (path: string) => void;
}

/** The files opened lately, newest first. Kept on this computer only. */
export function RecentFileList({ host, onOpen }: RecentFileListProps) {
  const { t, language } = useI18n();
  const [files, setFiles] = useState(() => loadRecentFiles(host));
  // Files opened in other tabs meanwhile: the list is read again each time this tab comes to the front.
  const { active } = host;
  useEffect(() => {
    if (active) setFiles(loadRecentFiles(host));
  }, [active, host]);
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }),
    [language],
  );

  const clear = () => {
    clearRecentFiles(host);
    setFiles([]);
  };

  return (
    <section className={styles.recent} aria-label={t('pdf-organizer.recent.title')}>
      <div className={styles.head}>
        <h2 className={styles.title}>{t('pdf-organizer.recent.title')}</h2>
        {files.length > 0 && (
          <Button variant="ghost" className={styles.clear} onClick={clear}>
            {t('pdf-organizer.recent.clear')}
          </Button>
        )}
      </div>

      {files.length === 0 ? (
        <p className={styles.none}>{t('pdf-organizer.recent.none')}</p>
      ) : (
        <ul className={styles.list}>
          {files.map((file) => (
            <li key={file.path}>
              <button type="button" className={styles.file} onClick={() => onOpen(file.path)}>
                <span className={styles.icon}>
                  <Icon name="file" size={18} />
                </span>
                <span className={styles.texts}>
                  <bdi className={styles.name}>{fileName(file.path)}</bdi>
                  <bdi className={styles.folder}>{folderOf(file.path)}</bdi>
                </span>
                <span className={styles.when}>
                  {t('pdf-organizer.recent.opened', { when: dateFormat.format(file.openedAt) })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
