import { useTranslation } from '@syntelab/i18n';
import { Icon, tooltip } from '@syntelab/ui-kit';
import { appInk, AppIcon, useApps, useAppTexts } from '../apps';
import { AppSwitcher } from '../app-switcher';
import { openChangelog, useChangelogUnread } from '../changelog';
import { openSitePage } from '../links';
import { useStore } from '../state/create-store';
import { tabs } from '../tabs';
import { openUpdateDialog, useUpdateState } from '../updates';
import styles from './app-bar.module.css';
import { useSupportNudge } from './use-support-nudge';

const ICON_SIZE = 22;
/** The quick actions at the bottom are a little smaller than the app's icon. */
const ACTION_ICON_SIZE = 20;

/**
 * The icon bar on the side. Top: the Syntelab logo, which lists the apps (each
 * opens in a window of its own), and the icon of this window's app, which
 * brings its first page back. Bottom: a newer version when there is one,
 * changelog, feedback, support and, last, Settings.
 */
export function AppBar() {
  const t = useTranslation();
  const { apps } = useApps();
  const home = apps.find((app) => app.manifest.id === tabs.homeApp);
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
      <AppSwitcher iconSize={ICON_SIZE} />

      {home && (
        <button
          type="button"
          className={styles.item}
          {...appInk(home)}
          data-app="true"
          {...named(appTexts.name(home))}
          aria-current={active?.id === `app:${tabs.homeApp}` ? 'page' : undefined}
          onClick={() => tabs.showHome()}
        >
          <span className={styles.appTile}>
            <AppIcon app={home} size={ICON_SIZE} />
          </span>
        </button>
      )}

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
