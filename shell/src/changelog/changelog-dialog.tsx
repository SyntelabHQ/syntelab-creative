import { useI18n } from '@syntelab/i18n';
import { localizeText } from '@syntelab/shell-api';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useMemo } from 'react';
import { openExternal } from '../platform';
import { preferences, updatePreferences } from '../preferences';
import { createStore, useStore } from '../state/create-store';
import styles from './changelog-dialog.module.css';
import { readChangelog, useChangelog } from './changelog-entries';

const isOpen = createStore(false);

/** Shows the changelog window. Everything in it then counts as read. */
export function openChangelog(): void {
  isOpen.set(true);
  const newest = readChangelog()[0];
  if (newest) updatePreferences({ changelogSeenId: newest.id });
}

/** True while the newest changelog entry has not been opened by the user. */
export function useChangelogUnread(): boolean {
  const { changelogSeenId } = useStore(preferences);
  const newest = useChangelog()[0];
  return newest !== undefined && newest.id !== changelogSeenId;
}

/** The changelog, in a window over the program. Rendered once by the shell. */
export function ChangelogDialog() {
  const { t, language, fallbackChain } = useI18n();
  const open = useStore(isOpen);
  const entries = useChangelog();
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: 'long' }), [language]);

  return (
    <Dialog
      open={open}
      onClose={() => isOpen.set(false)}
      title={t('shell.changelog.title')}
      closeLabel={t('common.action.close')}
    >
      {entries.length === 0 && <p className={styles.empty}>{t('shell.changelog.empty')}</p>}
      <ol className={styles.entries}>
        {entries.map((entry) => (
          <li key={entry.id} className={styles.entry}>
            <time className={styles.date} dateTime={entry.date}>
              {dateFormat.format(new Date(`${entry.date}T00:00:00`))}
            </time>
            <h3 className={styles.title}>{localizeText(entry.title, fallbackChain)}</h3>
            <p className={styles.body}>{localizeText(entry.body, fallbackChain)}</p>
            {entry.link && entry.linkLabel && (
              <Button variant="ghost" onClick={() => void openExternal(entry.link ?? '')}>
                {localizeText(entry.linkLabel, fallbackChain)}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Dialog>
  );
}
