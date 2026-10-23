import { useTranslation } from '@syntelab/i18n';
import { Icon, tooltip } from '@syntelab/ui-kit';
import { appInk, AppIcon, useApps, useAppTexts } from '../apps';
import { openChangelog, useChangelogUnread } from '../changelog';
import { openSitePage } from '../links';
import { preferences } from '../preferences';
import { useStore } from '../state/create-store';
import { tabs } from '../tabs';
import { openUpdateDialog, useUpdateState } from '../updates';
import styles from './app-bar.module.css';
import { useSupportNudge } from './use-support-nudge';

const ICON_SIZE = 22;
/** The quick actions at the bottom are a little smaller than Start and the apps. */
const ACTION_ICON_SIZE = 20;

/**
 * The icon bar on the side. Top: Start and the apps that can be opened and
 * that the user did not hide on the Start screen. Bottom: a newer version
 * when there is one, changelog, feedback, support and, last, Settings.
 */
export function AppBar() {
  const t = useTranslation();
  const { apps } = useApps();
  const { hiddenApps } = useStore(preferences);
  const shownApps = apps.filter((app) => app.manifest.status === 'active' && !hiddenApps.includes(app.manifest.id));
  const appTexts = useAppTexts();
  const state = useStore(tabs.store);
  const active = state.tabs.find((tab) => tab.id === state.activeId);
  const changelogUnread = useChangelogUnread();
  const supportNudge = useSupportNudge();
  const update = useUpdateState();

  /** The name read by screen readers, also shown as a tooltip beside the bar. */
  const named = (name: string) => ({ 'aria-label': name, ...tooltip(name, 'end') });

  return (
    <nav aria-label={t('shell.appBar.label')} className={styles.bar}>
      <button
        type="button"
        className={styles.item}
        {...named(t('shell.start.title'))}
        aria-current={active?.kind === 'start' ? 'page' : undefined}
        onClick={() => tabs.showStart()}
      >
        <Icon name="house" size={ICON_SIZE} />
      </button>

      {shownApps.map((app) => {
        const { id } = app.manifest;
        const name = appTexts.name(app);
        return (
          <button
            key={id}
            type="button"
            className={styles.item}
            {...appInk(app)}
            data-app="true"
            {...named(name)}
            aria-current={active?.appId === id ? 'page' : undefined}
            onClick={() => tabs.openApp(id)}
          >
            <span className={styles.appTile}>
              <AppIcon app={app} size={ICON_SIZE} />
            </span>
          </button>
        );
      })}

      <div className={styles.spacer} />

      {/* Only there while a newer version waits to be downloaded. */}
      {update.status === 'available' && (
        <button
          type="button"
          className={styles.item}
          data-action="update"
          {...named(t('shell.update.available', { version: update.info.latest }))}
          aria-haspopup="dialog"
          onClick={openUpdateDialog}
        >
          <Icon name="circle-arrow-up" size={ICON_SIZE} />
        </button>
      )}
      <button
        type="button"
        className={styles.item}
        data-action="changelog"
        data-unread={changelogUnread}
        {...named(t('shell.changelog.title'))}
        aria-haspopup="dialog"
        onClick={openChangelog}
      >
        <Icon name="changelog" size={ACTION_ICON_SIZE} />
      </button>
      <button
        type="button"
        className={styles.item}
        data-action="feedback"
        {...named(t('shell.help.feedback'))}
        onClick={() => openSitePage('feedback')}
      >
        <Icon name="feedback" size={ACTION_ICON_SIZE} />
      </button>
      <button
        type="button"
        className={styles.item}
        data-action="support"
        data-nudge={supportNudge}
        {...named(t('shell.donate.button'))}
        onClick={() => openSitePage('support')}
      >
        <Icon name="support" size={ACTION_ICON_SIZE} />
      </button>
      <button
        type="button"
        className={styles.item}
        {...named(t('shell.settings.title'))}
        aria-current={active?.kind === 'settings' ? 'page' : undefined}
        onClick={() => tabs.openSettings()}
      >
        <Icon name="gear" size={ICON_SIZE} />
      </button>
    </nav>
  );
}
