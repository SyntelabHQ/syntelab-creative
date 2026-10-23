import { useTranslation } from '@syntelab/i18n';
import { appColor, AppIcon, useApps, useAppTexts } from '../apps';
import styles from './app-placeholder-view.module.css';

export interface AppPlaceholderViewProps {
  readonly appId: string;
}

/** What an app tab shows when the app has no view yet. */
export function AppPlaceholderView({ appId }: AppPlaceholderViewProps) {
  const t = useTranslation();
  const { apps } = useApps();
  const appTexts = useAppTexts();
  const app = apps.find((candidate) => candidate.manifest.id === appId);
  if (!app) return null;

  return (
    <div className={styles.view}>
      <span className={styles.icon} style={{ background: appColor(app) }}>
        <AppIcon app={app} size={34} />
      </span>
      <h1 className={styles.name}>
        <bdi>{appTexts.name(app)}</bdi>
      </h1>
      <p className={styles.note}>{t('shell.app.notReady', { name: appTexts.name(app) })}</p>
    </div>
  );
}
