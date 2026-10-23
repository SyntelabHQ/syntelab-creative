import type { Command } from './command';

export interface CommandGroup {
  /** Translation key of the group's name; empty for commands without a group. */
  readonly groupKey: string;
  readonly commands: readonly Command[];
}

/** One top-level menu (classic), tab (ribbon) or section (side panel). */
export interface CommandMenu {
  readonly menuKey: string;
  readonly groups: readonly CommandGroup[];
}

/**
 * Arranges commands the way every layout shows them: by menu, then by group,
 * each in the order it first appears. Commands without a menu are left out
 * (they stay reachable through the search).
 */
export function buildMenus(commands: readonly Command[]): CommandMenu[] {
  const menus = new Map<string, Map<string, Command[]>>();
  for (const command of commands) {
    if (!command.menuKey) continue;
    const groups = menus.get(command.menuKey) ?? new Map<string, Command[]>();
    menus.set(command.menuKey, groups);
    const groupKey = command.groupKey ?? '';
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), command]);
  }
  return [...menus].map(([menuKey, groups]) => ({
    menuKey,
    groups: [...groups].map(([groupKey, groupCommands]) => ({ groupKey, commands: groupCommands })),
  }));
}

/**
 * Menus in a fixed order: the `first` ones (File, Edit, View…), then any
 * others as registered (an app's own menus), then the `last` ones (Help).
 */
export function orderMenus(
  menus: readonly CommandMenu[],
  first: readonly string[],
  last: readonly string[] = [],
): CommandMenu[] {
  const position = (menu: CommandMenu) => {
    const start = first.indexOf(menu.menuKey);
    if (start !== -1) return start;
    const end = last.indexOf(menu.menuKey);
    return end === -1 ? first.length : first.length + 1 + end;
  };
  return [...menus].sort((a, b) => position(a) - position(b));
}
