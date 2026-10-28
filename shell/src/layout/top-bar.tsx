import type { Command, CommandMenu } from '@syntelab/command-registry';
import { useTranslation } from '@syntelab/i18n';
import { Icon, IconButton, MenuButton } from '@syntelab/ui-kit';
import type { MenuItem, MenuSection } from '@syntelab/ui-kit';
import { useEffect, useRef, useState } from 'react';
import { AppSwitcher } from '../app-switcher';
import { LAST_MENUS, SearchButton, shortcutLabel } from '../commands';
import { SideActions } from '../side-actions';
import { useStore } from '../state/create-store';
import { tabs, TabStrip } from '../tabs';
import { openUpdateDialog, useUpdateState } from '../updates';
import { WindowButtons } from '../window/window-buttons';
import { CommandButton } from './command-button';
import styles from './top-bar.module.css';
import { commandHint, primaryCommands, runCommand } from './use-menus';

/** Below this width the search folds to its icon, so the tabs keep their room. */
const SEARCH_FOLDS_BELOW = 200;

export interface TopBarProps {
  /** The program's own menus: File, Edit, View, Help. */
  readonly menus: readonly CommandMenu[];
  /** Whether the app has tools, so their list can be folded to icons or unfolded; and whether it is folded now. */
  readonly tools: { readonly folded: boolean; readonly onToggle: () => void } | null;
}

/**
 * The one bar on top of the window, which is its title bar too: the Syntelab
 * logo (the apps, and this window's own first page), ☰ (folds the list of
 * tools to icons), the tabs, the search in the middle (Ctrl+K), the main
 * commands as icons (save, undo, print…), Settings, the menu of the program
 * (File, Edit, View, Help, each opening beside it) and the window's own buttons.
 * Where there is no list of tools (Settings, Help), what is new, feedback and
 * support are here too.
 * Where it is empty, it moves the window; a double click fills the screen.
 * With many tabs the search moves aside, then folds to its icon.
 */
export function TopBar({ menus, tools }: TopBarProps) {
  const t = useTranslation();
  const state = useStore(tabs.store);
  const settingsShown = state.tabs.find((tab) => tab.id === state.activeId)?.kind === 'settings';
  const update = useUpdateState();
  const searchRoom = useRef<HTMLDivElement>(null);
  const [searchFolded, setSearchFolded] = useState(false);
  useEffect(() => {
    const room = searchRoom.current;
    if (!room) return;
    const observer = new ResizeObserver(([entry]) => setSearchFolded((entry?.contentRect.width ?? 0) < SEARCH_FOLDS_BELOW));
    observer.observe(room);
    return () => observer.disconnect();
  }, []);

  const toItem = (command: Command): MenuItem => ({
    id: command.id,
    label: t(command.labelKey),
    kind: command.kind ?? 'action',
    icon: command.icon,
    checked: command.checked,
    disabled: command.disabled,
    hint: commandHint(command, t),
    shortcut: shortcutLabel(command),
    onSelect: () => runCommand(command),
  });
  const toSections = (menu: CommandMenu): MenuSection[] => menu.groups.map((group) => ({ id: group.groupKey, items: group.commands.map(toItem) }));
  // Help has its own place in the menus; its button would only repeat F1.
  const quick = primaryCommands(menus.filter((menu) => !(LAST_MENUS as readonly string[]).includes(menu.menuKey)));
  const program: MenuSection[] = [{ id: 'menus', items: menus.map((menu) => ({ id: menu.menuKey, label: t(menu.menuKey), kind: 'action', submenu: toSections(menu), onSelect: () => {} })) }];

  return (
    <div className={styles.bar} data-tauri-drag-region>
      <AppSwitcher iconSize={18} />
      {tools && (
        <span className={styles.fold}>
          <IconButton variant="ghost" aria-label={t(tools.folded ? 'shell.tools.unfold' : 'shell.tools.fold')} aria-pressed={!tools.folded} tooltipSide="bottom" onClick={tools.onToggle}>
            <Icon name="bars" size={18} />
          </IconButton>
        </span>
      )}
      <TabStrip />
      <div ref={searchRoom} className={styles.search} data-tauri-drag-region>
        <SearchButton folded={searchFolded} />
      </div>
      <div role="toolbar" aria-label={t('shell.layout.quick')} className={styles.quick}>
        {quick.map((commands, index) => (
          <div key={commands[0]?.id ?? index} className={styles.quickGroup}>
            {commands.map((command) => (
              <CommandButton key={command.id} command={command} shape="icon" tooltipSide="bottom-end" />
            ))}
          </div>
        ))}
      </div>
      <span className={styles.program}>
        {!tools && <SideActions stacked={false} tooltipSide="bottom-end" />}
        {/* Only there while a newer version waits to be downloaded. */}
        {update.status === 'available' && (
          <IconButton variant="ghost" className={styles.update} aria-label={t('shell.update.available', { version: update.info.latest })} aria-haspopup="dialog" tooltipSide="bottom-end" onClick={openUpdateDialog}>
            <Icon name="circle-arrow-up" size={18} />
          </IconButton>
        )}
        <IconButton variant="ghost" aria-label={t('shell.settings.title')} aria-pressed={settingsShown} tooltipSide="bottom-end" onClick={() => tabs.openSettings()}>
          <Icon name="gear" size={18} />
        </IconButton>
      </span>
      <span className={styles.menu}>
        <MenuButton label={t('shell.menu.program')} align="end" tooltipSide="bottom-end" sections={program}>
          {/* ⋮ */}
          <svg viewBox="0 0 4 16" width="4" height="16" aria-hidden="true" className={styles.dots}>
            <circle cx="2" cy="2" r="1.6" />
            <circle cx="2" cy="8" r="1.6" />
            <circle cx="2" cy="14" r="1.6" />
          </svg>
        </MenuButton>
      </span>
      <WindowButtons />
    </div>
  );
}
