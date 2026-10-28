import { useI18n, useTranslation } from '@syntelab/i18n';
import { Icon, tooltip } from '@syntelab/ui-kit';
import type { KeyboardEvent } from 'react';
import { appInk, AppIcon, useApps, useAppTexts } from '../apps';
import { preferences } from '../preferences';
import { useStore } from '../state/create-store';
import styles from './tab-strip.module.css';
import { tabs as tabsController } from './tabs-controller';
import type { Tab } from './tabs-controller';

/** DOM id of a tab's button; the tab panel points at it with aria-labelledby. */
export function tabElementId(tabId: string): string {
  return `tab-${tabId}`;
}

export const TAB_PANEL_ID = 'tab-panel';

/** The title a tab shows: what the app set, else the app's or the shell screen's name. */
export function useTabTitle(): (tab: Tab) => string {
  const t = useTranslation();
  const { apps } = useApps();
  const appTexts = useAppTexts();
  return (tab) => {
    if (tab.kind === 'settings') return t('shell.settings.title');
    if (tab.kind === 'help') return t('shell.help.title');
    if (tab.title !== undefined) return tab.title;
    const app = apps.find((candidate) => candidate.manifest.id === tab.appId);
    return app ? appTexts.name(app) : (tab.appId ?? '');
  };
}

export function TabStrip() {
  const { t, direction } = useI18n();
  const { tabs: openTabs, activeId } = useStore(tabsController.store);
  const { tabMark } = useStore(preferences);
  // The app's first page has a tab only while it is in front or nothing else is open: the house before the tabs
  // brings it back, and it comes back by itself when the last other tab closes.
  const homeId = `app:${tabsController.homeApp}`;
  const tabs = openTabs.filter((tab) => tab.id !== homeId || tab.id === activeId || openTabs.length === 1);
  const homeHidden = !tabs.some((tab) => tab.id === homeId);
  const { apps } = useApps();
  const appTexts = useAppTexts();

  const appOf = (tab: Tab) => apps.find((app) => app.manifest.id === tab.appId);
  const homeApp = apps.find((app) => app.manifest.id === tabsController.homeApp);
  const homeName = t('shell.tabs.home', { app: homeApp ? appTexts.name(homeApp) : tabsController.homeApp });

  const titleOf = (tab: Tab): string => {
    if (tab.kind === 'settings') return t('shell.settings.title');
    if (tab.kind === 'help') return t('shell.help.title');
    if (tab.title !== undefined) return tab.title;
    const app = appOf(tab);
    return app ? appTexts.name(app) : (tab.appId ?? '');
  };

  // Arrow keys follow the reading direction; Home and End jump to the ends.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    const index = tabs.findIndex((tab) => tab.id === activeId);
    let next: Tab | undefined;
    if (event.key === forward) next = tabs[(index + 1) % tabs.length];
    else if (event.key === backward) next = tabs[(index - 1 + tabs.length) % tabs.length];
    else if (event.key === 'Home') next = tabs[0];
    else if (event.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    event.preventDefault();
    tabsController.activate(next.id);
    document.getElementById(tabElementId(next.id))?.focus();
  };

  return (
    <div role="tablist" aria-label={t('shell.tabs.label')} className={styles.strip} data-tauri-drag-region onKeyDown={onKeyDown}>
      {homeHidden && (
        <button
          type="button"
          role="tab"
          aria-selected={false}
          tabIndex={-1}
          className={styles.home}
          aria-label={homeName}
          {...tooltip(homeName)}
          onClick={() => tabsController.showHome()}
        >
          <Icon name="house" size={14} />
        </button>
      )}
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        const title = titleOf(tab);
        const app = appOf(tab);
        return (
          <div key={tab.id} role="presentation" className={styles.tab} data-selected={selected}>
            <button
              type="button"
              {...tooltip(title)}
              role="tab"
              id={tabElementId(tab.id)}
              aria-selected={selected}
              aria-controls={TAB_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              className={styles.title}
              onClick={() => tabsController.activate(tab.id)}
            >
              {tab.kind === 'settings' && <Icon name="gear" size={13} />}
              {tab.kind === 'help' && <Icon name="book-open" size={13} />}
              {app &&
                (tabMark === 'icon' && app.iconSvg ? (
                  <span className={styles.appIcon} {...appInk(app)}>
                    <AppIcon app={app} size={15} />
                  </span>
                ) : (
                  <span className={styles.dot} {...appInk(app)} />
                ))}
              <bdi className={styles.name}>{title}</bdi>
              {tab.unsaved && <span className={styles.unsaved} aria-label={t('shell.tabs.unsaved')} role="img" />}
            </button>
            {tab.closable && (
              <button
                type="button"
                className={styles.close}
                aria-label={t('shell.tabs.close', { title })}
                {...tooltip(t('common.action.close'))}
                onClick={() => tabsController.requestClose(tab.id)}
              >
                <Icon name="xmark" size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
