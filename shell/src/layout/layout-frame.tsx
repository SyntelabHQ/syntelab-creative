import { useI18n } from '@syntelab/i18n';
import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useApps } from '../apps';
import { commandRegistry } from '../commands';
import { preferences, resolveAppLayout, setAppLayout, setGlobalLayout } from '../preferences';
import { useStore } from '../state/create-store';
import { ClassicBars } from './classic/classic-bars';
import { layoutCommands } from './layout-commands';
import styles from './layout-frame.module.css';
import { Ribbon } from './ribbon/ribbon';
import { SidePanel } from './side-panel/side-panel';
import { useMenus } from './use-menus';

export interface LayoutFrameProps {
  /** The app in front, or undefined where the tools make no sense (Start, Settings). */
  readonly appId: string | undefined;
  /** True while the app asked for the bars to hide (read mode, full screen). */
  readonly hidden: boolean;
  /** The tab's content. */
  readonly children: ReactNode;
}

/**
 * Puts the commands around the content in the layout chosen for the app in
 * front: classic (menu bar and toolbar on top), ribbon (on top), or side panel
 * (left or right). All three show the same commands, from the command
 * registry. Each app has its own default and remembers the user's choice.
 */
export function LayoutFrame({ appId, hidden, children }: LayoutFrameProps) {
  const { appLayouts, globalLayout, toolsCollapsed } = useStore(preferences);
  const { direction } = useI18n();
  const { apps } = useApps();
  const menus = useMenus();

  const appDefault = apps.find((app) => app.manifest.id === appId)?.manifest.defaultLayout;
  const { layout, panelSide, ribbonMode } = resolveAppLayout(appLayouts, appId ?? '', appDefault, globalLayout);

  // "Layout" in the View menu switches the layout of this app.
  const switches = useMemo(
    () => (appId ? layoutCommands(appId, { layout, panelSide, ribbonMode }) : []),
    [appId, layout, panelSide, ribbonMode],
  );
  useEffect(() => commandRegistry.registerAll(switches), [switches]);

  // Whatever stands around the content, the content itself keeps its place in what is drawn: the tabs of the
  // apps live inside it, and a tab that was moved would start again from nothing (its text, its place, its
  // history) every time the user went to Start, to Settings, or to an app with another layout.
  const bare = !appId || hidden;
  const sideways = !bare && layout === 'side-panel';
  // "Left" and "right" are meant literally, whatever the reading direction.
  const edge = (panelSide === 'left') === (direction === 'ltr') ? 'start' : 'end';
  const panel = sideways ? <SidePanel key="panel" menus={menus} collapsed={toolsCollapsed} edge={edge} /> : null;
  const top = bare || sideways ? null : layout === 'ribbon' ? <Ribbon key="ribbon" menus={menus} mode={ribbonMode} onModeChange={(mode) => (appId ? setAppLayout(appId, { ribbonMode: mode }) : setGlobalLayout({ ribbonMode: mode }))} /> : <ClassicBars key="classic" menus={menus} />;

  return (
    <div className={styles.frame} data-direction={sideways ? 'row' : undefined}>
      {top}
      {edge === 'start' && panel}
      <div key="content" className={styles.content}>
        {children}
      </div>
      {edge === 'end' && panel}
    </div>
  );
}
