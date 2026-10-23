import { useTranslation } from '@syntelab/i18n';
import type { AppEntry } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { Suspense, useMemo } from 'react';
import { appSettingsView, createAppSettingsHost } from '../app-host';
import { appInk, AppIcon, useApps, useAppTexts } from '../apps';
import { LanguagePicker, LayoutPicker, ShortcutsPicker, TabsPicker, ThemePicker, TooltipsPicker } from '../preferences';
import { useStore } from '../state/create-store';
import { UpdateSettings } from '../updates';
import { ExplorerMenuSetting } from './explorer-menu-setting';
import { GENERAL_SECTION, settingsSection, showSettingsSection } from './settings-section';
import styles from './settings-view.module.css';

/** The settings of the whole suite: theme, language, the layout every app follows, updates. */
function GeneralSettings() {
  const t = useTranslation();
  return (
    <>
      <h1 className={styles.title}>{t('shell.settings.general')}</h1>
      <div className={styles.fields}>
        <ThemePicker />
        <LanguagePicker />
      </div>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('shell.settings.layout')}</h2>
        <p className={styles.note}>{t('shell.layout.globalNote')}</p>
        <LayoutPicker />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('shell.settings.tabs')}</h2>
        <TabsPicker />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('shell.settings.tooltips')}</h2>
        <TooltipsPicker />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('shell.settings.shortcuts')}</h2>
        <ShortcutsPicker />
      </section>

      <ExplorerMenuSetting sectionClassName={styles.section} headingClassName={styles.heading} />

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('shell.settings.updates')}</h2>
        <UpdateSettings />
      </section>
    </>
  );
}

/** The settings of one app: its layout, then whatever the app itself offers. */
function AppSettings({ app, name }: { readonly app: AppEntry; readonly name: string }) {
  const t = useTranslation();
  const appId = app.manifest.id;
  const Own = appSettingsView(appId);
  const host = useMemo(() => createAppSettingsHost(appId), [appId]);
  return (
    <>
      <h1 className={styles.title}>
        <bdi>{name}</bdi>
      </h1>
      <p className={styles.note}>{t('shell.settings.appNote', { app: name })}</p>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('shell.settings.layout')}</h2>
        <LayoutPicker app={app} />
      </section>

      {Own && (
        <Suspense fallback={null}>
          <Own host={host} />
        </Suspense>
      )}
    </>
  );
}

/** Settings: a part for the whole suite, and a part for each app, chosen on the side. */
export function SettingsView() {
  const t = useTranslation();
  const { apps } = useApps();
  const appTexts = useAppTexts();
  const usableApps = apps.filter((app) => app.manifest.status === 'active');
  const wanted = useStore(settingsSection);
  const shownApp = usableApps.find((app) => app.manifest.id === wanted);

  return (
    <div className={styles.settings}>
      <nav className={styles.nav} aria-label={t('shell.settings.title')}>
        <h2 className={styles.navTitle}>{t('shell.settings.title')}</h2>
        <button type="button" className={styles.navItem} aria-current={shownApp ? undefined : 'page'} onClick={() => showSettingsSection(GENERAL_SECTION)}>
          <Icon name="gear" size={16} />
          {t('shell.settings.general')}
        </button>
        {usableApps.length > 0 && <span className={styles.navGroup}>{t('shell.settings.apps')}</span>}
        {usableApps.map((app) => (
          <button
            key={app.manifest.id}
            type="button"
            className={styles.navItem}
            aria-current={shownApp === app ? 'page' : undefined}
            onClick={() => showSettingsSection(app.manifest.id)}
          >
            {app.iconSvg ? (
              <span className={styles.navIcon} {...appInk(app)} aria-hidden="true">
                <AppIcon app={app} size={17} />
              </span>
            ) : (
              <span className={styles.navDot} {...appInk(app)} aria-hidden="true" />
            )}
            <bdi>{appTexts.name(app)}</bdi>
          </button>
        ))}
      </nav>
      <div className={styles.view}>{shownApp ? <AppSettings app={shownApp} name={appTexts.name(shownApp)} /> : <GeneralSettings />}</div>
    </div>
  );
}
