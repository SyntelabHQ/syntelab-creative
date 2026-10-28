import type { CommandMenu } from '@syntelab/command-registry';
import type { ToolColor, ToolEntry } from '@syntelab/shell-api';
import { FIRST_MENUS, LAST_MENUS } from '../../commands';
import { createStore, useStore } from '../../state/create-store';

/** One tool of the app in front: one of its own menus, with what the list of tools shows for it. */
export interface Tool {
  readonly menu: CommandMenu;
  readonly icon: string;
  /** The key of a sentence saying what the tool is for. */
  readonly hintKey?: string;
  readonly color?: ToolColor;
  /** The command the tool runs instead of opening a bar. */
  readonly run?: string;
  /** Shown on the bar while no tool is open. */
  readonly quick: boolean;
}

/** Shown for a tool the app's `app.json` does not name. */
const PLAIN_ICON = 'wrench';

const COMMON: readonly string[] = [...FIRST_MENUS, ...LAST_MENUS];

/**
 * Splits the menus into the program's own (File, Edit, View, Help: the menu
 * bar on top) and the app's tools (the list on the side), in the order
 * `app.json` gives them; tools it does not name come after, in their own order.
 */
export function splitMenus(menus: readonly CommandMenu[], entries: readonly ToolEntry[] = []): { common: CommandMenu[]; tools: Tool[] } {
  const common = menus.filter((menu) => COMMON.includes(menu.menuKey));
  const own = menus.filter((menu) => !COMMON.includes(menu.menuKey));
  const rank = (menu: CommandMenu) => {
    const index = entries.findIndex((entry) => entry.menuKey === menu.menuKey);
    return index < 0 ? entries.length : index;
  };
  const tools = [...own]
    .sort((a, b) => rank(a) - rank(b))
    .map((menu): Tool => {
      const entry = entries.find((known) => known.menuKey === menu.menuKey);
      return { menu, icon: entry?.icon ?? PLAIN_ICON, hintKey: entry?.hintKey, color: entry?.color, run: entry?.run, quick: entry?.quick ?? false };
    });
  return { common, tools };
}

/** The tool whose bar is open, by tab id; none while the user only reads. Kept while the program runs. */
const openTools = createStore<Readonly<Record<string, string | null>>>({});

/** Opens the bar of one of the tools of a tab (by the key of its menu), or closes it with null. */
export function showTool(tabId: string, menuKey: string | null): void {
  openTools.set((current) => (current[tabId] === menuKey ? current : { ...current, [tabId]: menuKey }));
}

/** The key of the menu of the tool whose bar is open in a tab, or null. */
export function useOpenTool(tabId: string | undefined): string | null {
  const open = useStore(openTools);
  return tabId ? (open[tabId] ?? null) : null;
}

/** The tabs whose app wants the idle bar shown (they show something to work on). */
const idleTabs = createStore<ReadonlySet<string>>(new Set());

/** Shows the idle bar over a tab while no tool is open, or takes it away. */
export function setIdleBar(tabId: string, shown: boolean): void {
  idleTabs.set((current) => {
    if (current.has(tabId) === shown) return current;
    const next = new Set(current);
    if (shown) next.add(tabId);
    else next.delete(tabId);
    return next;
  });
}

/** Whether a tab wants the idle bar. */
export function useIdleBar(tabId: string | undefined): boolean {
  const shown = useStore(idleTabs);
  return tabId !== undefined && shown.has(tabId);
}

/** The color of a tool, for its icon: a token of the theme. */
export function toolColor(tool: Pick<Tool, 'color'>): string | undefined {
  return tool.color ? `var(--sc-tool-${tool.color})` : undefined;
}

/** Whether something of a tool can be used now: its command, or one of its menu's. */
export function toolUsable(tool: Tool): boolean {
  const commands = tool.menu.groups.flatMap((group) => group.commands);
  if (tool.run) return commands.some((command) => command.id === tool.run && !command.disabled);
  return commands.some((command) => !command.disabled);
}
