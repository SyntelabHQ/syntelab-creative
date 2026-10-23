import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useEffect } from 'react';
import { closeWindow, onWindowCloseRequested } from '../platform';
import { useStore } from '../state/create-store';
import styles from './close-guard.module.css';
import { tabs } from './tabs-controller';

export interface CloseGuardProps {
  /** The title shown on a tab, for the question. */
  readonly titleOf: (tabId: string) => string;
}

/**
 * Stands between the user and losing unsaved changes: closing a tab that has
 * some, or the whole program while any tab has some, asks first. Rendered
 * once by the window.
 */
export function CloseGuard({ titleOf }: CloseGuardProps) {
  const t = useTranslation();
  const { pendingClose, tabs: openTabs } = useStore(tabs.store);

  // The window's own close button goes through the same question.
  useEffect(() => onWindowCloseRequested(() => tabs.requestCloseWindow()), []);

  const unsavedCount = openTabs.filter((tab) => tab.unsaved).length;
  const confirm = () => {
    if (pendingClose?.kind === 'tab') tabs.close(pendingClose.tabId);
    else if (pendingClose?.kind === 'window') void closeWindow();
  };

  return (
    <Dialog
      open={pendingClose !== null}
      onClose={() => tabs.cancelClose()}
      title={t('shell.close.title')}
      closeLabel={t('common.action.cancel')}
    >
      <p className={styles.question}>
        {pendingClose?.kind === 'window'
          ? t('shell.close.windowQuestion', { count: unsavedCount })
          : t('shell.close.tabQuestion', { title: pendingClose ? titleOf(pendingClose.tabId) : '' })}
      </p>
      <p className={styles.note}>{t('shell.close.note')}</p>
      <div className={styles.actions}>
        <Button variant="outline" onClick={() => tabs.cancelClose()}>
          {t('shell.close.stay')}
        </Button>
        <Button variant="outline" className={styles.discard} onClick={confirm}>
          {t('shell.close.discard')}
        </Button>
      </div>
    </Dialog>
  );
}
