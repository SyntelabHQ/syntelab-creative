import { useLaunchRequests } from '../launch/use-launch-requests';
import { useEffect } from 'react';
import { AppBar } from '../app-bar';
import { useWindowTitle } from './use-window-title';
import { AppTabView } from '../app-host';
import { ChangelogDialog } from '../changelog';
import { useCommandShortcuts } from '../commands';
import { HelpView } from '../help';
import { useEscapeLeavesImmersive, useImmersive } from '../immersive';
import { LayoutFrame } from '../layout';
import { SettingsView, useExplorerMenuUpkeep } from '../settings';
import { useStore } from '../state/create-store';
import { CloseGuard, TAB_PANEL_ID, tabElementId, tabs, TabStrip, useTabTitle } from '../tabs';
import { checkForUpdatesAtStart, UpdateDialog } from '../updates';
import styles from './shell-window.module.css';

/** The window of one app: app bar on the side, tabs on top, the active tab below. */
export function ShellWindow() {
  // Named after its app, in the user's language: the taskbar shows the name.
  useWindowTitle();
  // Files the program was started with, and entries chosen in the file manager's menu.
  useLaunchRequests();
  // Entries of the file manager's menu that start another program are pointed at this one.
  useExplorerMenuUpkeep();
  const state = useStore(tabs.store);
  // An app can ask for the whole window; the bars come back with Escape.
  const barsHidden = useImmersive() !== 'none';
  useEscapeLeavesImmersive();
  useCommandShortcuts();
  // Once per run, and only if the user allows online checks.
  useEffect(checkForUpdatesAtStart, []);
  const titleOf = useTabTitle();
  const active = state.tabs.find((tab) => tab.id === state.activeId) ?? state.tabs[0];
  if (!active) return null;

  return (
    <div className={styles.window}>
      {!barsHidden && <AppBar />}
      <ChangelogDialog />
      <UpdateDialog />
      <CloseGuard titleOf={(tabId) => titleOf(state.tabs.find((tab) => tab.id === tabId) ?? state.tabs[0]!)} />
      <div className={styles.main}>
        {!barsHidden && <TabStrip />}
        {/* The menus, ribbon or side panel belong to apps; Settings and Help have none. */}
        <LayoutFrame appId={active.kind === 'app' ? active.appId : undefined} hidden={barsHidden}>
          <main
            id={TAB_PANEL_ID}
            role="tabpanel"
            aria-labelledby={tabElementId(active.id)}
            className={styles.panel}
          >
            {active.kind === 'settings' && <SettingsView />}
            {active.kind === 'help' && <HelpView />}
            {/* App tabs stay alive while hidden, so a document keeps its place. */}
            {state.tabs
              .filter((tab) => tab.kind === 'app')
              .map((tab) => (
                <div key={tab.id} className={styles.appTab} hidden={tab.id !== active.id}>
                  <AppTabView tab={tab} active={tab.id === active.id} />
                </div>
              ))}
          </main>
        </LayoutFrame>
      </div>
    </div>
  );
}
