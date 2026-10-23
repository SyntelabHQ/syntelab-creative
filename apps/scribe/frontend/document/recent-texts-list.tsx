import { useI18n } from '@syntelab/i18n';
import { fileName, folderOf } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useMemo, useState } from 'react';
import { forgetRecentTexts, loadRecentTexts } from './recent-texts';
import styles from './recent-texts-list.module.css';

export interface RecentTextsProps {
  readonly host: Pick<AppHost, 'loadData' | 'saveData'>;
  readonly onOpen: (path: string) => void;
}

/**
 * The texts opened lately, newest first: shown on a new text while it is
 * still empty, where there is room for them. Nothing when there are none.
 */
export function RecentTexts({ host, onOpen }: RecentTextsProps) {
  const { t, language } = useI18n();
  const [texts, setTexts] = useState(() => loadRecentTexts(host));
  const when = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }), [language]);
  if (texts.length === 0) return null;
  return (
    <section className={styles.recent} aria-label={t('scribe.recent.title')}>
      <div className={styles.head}>
        <h2 className={styles.title}>{t('scribe.recent.title')}</h2>
        <Button
          variant="ghost"
          onClick={() => {
            forgetRecentTexts(host);
            setTexts([]);
          }}
        >
          {t('scribe.recent.forget')}
        </Button>
      </div>
      <ul className={styles.list}>
        {texts.map((text) => (
          <li key={text.path}>
            <button type="button" className={styles.text} onClick={() => onOpen(text.path)}>
              <Icon name="file" size={16} />
              <span className={styles.names}>
                <bdi className={styles.name}>{fileName(text.path)}</bdi>
                <bdi className={styles.folder} dir="ltr">
                  {folderOf(text.path)}
                </bdi>
              </span>
              <span className={styles.when}>{when.format(text.openedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
