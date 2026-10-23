import { useState } from 'react';
import { useI18n } from '@syntelab/i18n';
import { localizeText } from '@syntelab/shell-api';
import { Button, Dialog } from '@syntelab/ui-kit';
import { installUpdate, openExternal } from '../platform';
import type { InstallProgress } from '../platform';
import { APP_VERSION, closeUpdateDialog, useUpdateDialogOpen, useUpdateState } from './update-store';
import styles from './update-dialog.module.css';

/** Where installing the update has got to, while the dialog is open. */
type Install =
  | { readonly step: 'asked' }
  | { readonly step: 'working'; readonly progress: InstallProgress | null }
  | { readonly step: 'failed' };

/**
 * Tells the user a newer version exists and offers to install it, or to get it
 * from the download page. Nothing is downloaded or installed without the user
 * choosing to. Rendered once by the shell.
 */
export function UpdateDialog() {
  const { t, fallbackChain } = useI18n();
  const state = useUpdateState();
  const open = useUpdateDialogOpen() && state.status === 'available';
  const info = state.status === 'available' ? state.info : null;
  const [install, setInstall] = useState<Install>({ step: 'asked' });
  const working = install.step === 'working';

  const close = () => {
    // The download cannot be stopped half way; the window stays until it ends.
    if (working) return;
    setInstall({ step: 'asked' });
    closeUpdateDialog();
  };

  const start = () => {
    setInstall({ step: 'working', progress: null });
    installUpdate((progress) => setInstall({ step: 'working', progress })).catch(() => setInstall({ step: 'failed' }));
  };

  const progress = install.step === 'working' ? install.progress : null;
  const percent = progress?.total ? Math.min(100, Math.floor((progress.done / progress.total) * 100)) : undefined;

  return (
    <Dialog open={open} onClose={close} title={t('shell.update.title')} closeLabel={t('common.action.close')}>
      {info && (
        <div className={styles.content}>
          <p className={styles.lead}>{t('shell.update.available', { version: info.latest })}</p>
          <p className={styles.note}>{t('shell.update.yours', { version: APP_VERSION })}</p>
          {info.notes && <p className={styles.notes}>{localizeText(info.notes, fallbackChain)}</p>}
          {install.step === 'asked' && <p className={styles.note}>{t('shell.update.installNote')}</p>}
          {working && (
            <div className={styles.progress}>
              <span>{percent === undefined ? t('shell.update.installing') : t('shell.update.installingPercent', { percent })}</span>
              <progress className={styles.bar} max={100} value={percent} />
            </div>
          )}
          {install.step === 'failed' && <p className={styles.failed}>{t('shell.update.installFailed')}</p>}
          <div className={styles.actions}>
            <Button disabled={working} onClick={close}>
              {t('shell.update.later')}
            </Button>
            <Button
              variant={install.step === 'failed' ? 'primary' : undefined}
              disabled={working}
              onClick={() => {
                void openExternal(info.download);
                close();
              }}
            >
              {t('shell.update.download')}
            </Button>
            {install.step !== 'failed' && (
              <Button variant="primary" disabled={working} onClick={start}>
                {t('shell.update.install')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
