import { useTranslation } from '@syntelab/i18n';
import type { ReactNode } from 'react';
import { useApps } from '../apps';
import { CommandPalette, commandRegistry } from '../commands';
import type { Found } from '../commands';
import { preferences, updatePreferences } from '../preferences';
import { useStore } from '../state/create-store';
import styles from './layout-frame.module.css';
import { IdleBar } from './tools/idle-bar';
import { ToolBar } from './tools/tool-bar';
import { ToolList } from './tools/tool-list';
import { showTool, splitMenus, toolColor, toolUsable, useIdleBar, useOpenTool } from './tools/use-tools';
import type { Tool } from './tools/use-tools';
import { TopBar } from './top-bar';
import { useMenus } from './use-menus';

export interface LayoutFrameProps {
  /** The app in front, or undefined where there are no tools (Settings, Help). */
  readonly appId: string | undefined;
  /** The tab in front: each tab has its own open tool. */
  readonly tabId: string | undefined;
  /** True while the app asked for the bars to hide (read mode, full screen). */
  readonly hidden: boolean;
  /** The tab's content. */
  readonly children: ReactNode;
}

/**
 * Puts the commands around the content, the same way in every app: on top
 * the menu of the program, the search and the main commands; on the side
 * the app's tools, named by what the user wants to do; over the content the
 * bar of the tool the user opened, until Done (or, while none is, the tools
 * used most). Everything comes from the command registry.
 */
export function LayoutFrame({ appId, tabId, hidden, children }: LayoutFrameProps) {
  const t = useTranslation();
  const { toolsCollapsed } = useStore(preferences);
  const { apps } = useApps();
  const menus = useMenus();
  const manifest = apps.find((app) => app.manifest.id === appId)?.manifest;
  const { common, tools } = splitMenus(menus, manifest?.tools);
  const openKey = useOpenTool(tabId);
  const idleWanted = useIdleBar(tabId);
  const open = tools.find((tool) => tool.menu.menuKey === openKey);
  const hasTools = appId !== undefined && tabId !== undefined && tools.length > 0;
  const listShown = !hidden && hasTools;

  /** A tool was chosen, in the list or on the bar: its bar opens (or closes, if open); a tool of one step runs. */
  const choose = (tool: Tool) => {
    if (!tabId) return;
    // A tool of one step runs it; while it cannot (no document yet), the app is told the tool was asked for, and may ask for a file first.
    const step = tool.run ? tool.menu.groups.flatMap((group) => group.commands).find((command) => command.id === tool.run) : undefined;
    if (step && !step.disabled) {
      void commandRegistry.execute(step.id);
      return;
    }
    showTool(tabId, tool.menu.menuKey === openKey ? null : tool.menu.menuKey);
  };

  // The search window lists the tools before anything is typed, and finds them by name and by what they do.
  const toolItems: Found[] = hasTools
    ? tools.map((tool) => ({ id: `tool:${tool.menu.menuKey}`, label: t(tool.menu.menuKey), icon: tool.icon, color: toolColor(tool), detail: tool.hintKey ? t(tool.hintKey) : undefined, names: [t(tool.menu.menuKey), ...(tool.hintKey ? [t(tool.hintKey)] : [])], run: () => tool.menu.menuKey !== openKey && choose(tool) }))
    : [];

  // While the tab shows something to work on, the tools used most stand on the idle bar, those that can be used now.
  const quick = tools.filter((tool) => tool.quick && toolUsable(tool));
  const idleShown = !hidden && hasTools && idleWanted && !open && manifest?.idleTool && quick.length > 0;

  // Whatever stands around the content, the content itself keeps its place in what is drawn: the tabs of the
  // apps live inside it, and a tab that was moved would start again from nothing (its text, its place, its
  // history) every time a bar came or went.
  return (
    <div className={styles.frame}>
      {!hidden && <TopBar menus={common} tools={hasTools ? { folded: toolsCollapsed, onToggle: () => updatePreferences({ toolsCollapsed: !toolsCollapsed }) } : null} />}
      <div className={styles.row}>
        {listShown && <ToolList tools={tools} open={open ? openKey : null} folded={toolsCollapsed} onFold={(folded) => updatePreferences({ toolsCollapsed: folded })} onChoose={choose} />}
        <div className={styles.column}>
          {!hidden && open && tabId && <ToolBar tool={open} onDone={() => showTool(tabId, null)} />}
          {idleShown && manifest?.idleTool && <IdleBar idle={manifest.idleTool} tools={quick} onChoose={choose} />}
          <div className={styles.content}>{children}</div>
        </div>
      </div>
      <CommandPalette tools={toolItems} />
    </div>
  );
}
