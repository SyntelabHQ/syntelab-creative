import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useCallback, useEffect, useState } from 'react';
import styles from './default-app-note.module.css';

export interface DefaultAppNoteProps {
  readonly host: Pick<AppHost, 'isDefaultPdfApp' | 'openDefaultAppSettings'>;
}

/**
 * Whether PDF Organizer opens PDF files on this computer: a thank-you when it
 * does, else a button to the system's settings, where the user chooses it (a
 * program cannot choose itself). Asked again when the window comes back to
 * the front, after the user was in the settings. Nothing where the system
 * does not let it be chosen.
 */
export function DefaultAppNote({ host }: DefaultAppNoteProps) {
  const t = useTranslation();
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const [problem, setProblem] = useState(false);
  const { isDefaultPdfApp, openDefaultAppSettings } = host;

  const check = useCallback(() => {
    isDefaultPdfApp()
      .then(setIsDefault)
      .catch(() => setIsDefault(null));
  }, [isDefaultPdfApp]);

  useEffect(() => {
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [check]);

  if (isDefault === null) return null;
  if (isDefault) {
    return (
      <p className={styles.note} role="status">
        <span className={styles.mark}>
          <Icon name="circle-check" size={16} />
        </span>
        <span>{t('pdf-organizer.defaultApp.thanks')}</span>
      </p>
    );
  }

  const open = () => {
    setProblem(false);
    openDefaultAppSettings().catch(() => setProblem(true));
  };

  return (
    <div className={styles.note}>
      <span>{t('pdf-organizer.defaultApp.offer')}</span>
      <Button className={styles.button} onClick={open}>
        {t('pdf-organizer.defaultApp.makeDefault')}
      </Button>
      {problem && (
        <span className={styles.problem} role="alert">
          {t('pdf-organizer.defaultApp.failed')}
        </span>
      )}
    </div>
  );
}
