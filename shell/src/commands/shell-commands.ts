import { createCommandRegistry } from '@syntelab/command-registry';
import type { Command, CommandRegistry } from '@syntelab/command-registry';
import { openChangelog } from '../changelog';
import { openHelp } from '../help/help-state';
import { openSitePage } from '../links';
import { preferences, updatePreferences } from '../preferences/preferences-store';
import { showSettingsSection } from '../settings/settings-section';
import { tabs } from '../tabs';

/**
 * The top-level menus every layout shows first and last; an app's own menus
 * (Organize, Sign…) go between them. Apps use the same keys for these.
 */
export const FIRST_MENUS = ['common.menu.file', 'common.menu.edit', 'common.menu.view'] as const;
export const LAST_MENUS = ['common.menu.help'] as const;
const [FILE] = FIRST_MENUS;
const [HELP] = LAST_MENUS;

const NAVIGATION = 'shell.command.group.navigation';

/** The app whose tab is in front; null on Settings and Help. */
function appInFront(): string | null {
  const { tabs: open, activeId } = tabs.store.get();
  const tab = open.find((known) => known.id === activeId);
  return tab?.kind === 'app' ? (tab.appId ?? null) : null;
}

/**
 * "Go to Start" goes to the first page of the window's app: an app whose tabs
 * have a start of their own registers a command named `<app-id>.start` for the
 * tab in front, and this runs it. From anywhere else it brings the app's first
 * tab to the front.
 */
function goToStart(): void | Promise<void> {
  const app = appInFront();
  const own = app ? commandRegistry.get(`${app}.start`) : undefined;
  if (own && !own.disabled) return own.run();
  tabs.showHome();
}

/** "Open Settings", from inside an app, opens Settings at that app's own part; the other parts are a click away there. */
function openSettings(): void {
  const app = appInFront();
  if (app) showSettingsSection(app);
  tabs.openSettings();
}

/** Commands the shell itself offers. Apps add theirs to the same registry. */
const SHELL_COMMANDS: readonly Command[] = [
  {
    id: 'shell.goToStart',
    labelKey: 'shell.command.goToStart',
    menuKey: FILE,
    groupKey: NAVIGATION,
    icon: 'house',
    run: goToStart,
  },
  {
    id: 'shell.openSettings',
    labelKey: 'shell.command.openSettings',
    menuKey: FILE,
    groupKey: NAVIGATION,
    icon: 'gear',
    shortcut: 'Mod+,',
    run: openSettings,
  },
  // The theme belongs to the whole program (every window, Settings), not to an app's
  // View menu; these are found by the search.
  {
    id: 'shell.themeLight',
    labelKey: 'shell.command.themeLight',
    icon: 'sun',
    run: () => updatePreferences({ theme: 'light' }),
  },
  {
    id: 'shell.themeDark',
    labelKey: 'shell.command.themeDark',
    icon: 'moon',
    run: () => updatePreferences({ theme: 'dark' }),
  },
  {
    id: 'shell.themeAuto',
    labelKey: 'shell.command.themeAuto',
    hintKey: 'shell.command.themeAutoHint',
    icon: 'circle-half-stroke',
    run: () => updatePreferences({ theme: 'auto' }),
  },
  // The changelog has its place in the app bar; here it is only found by the search.
  {
    id: 'shell.openChangelog',
    labelKey: 'shell.changelog.title',
    icon: 'changelog',
    run: openChangelog,
  },
  {
    id: 'shell.nextTab',
    labelKey: 'shell.command.nextTab',
    icon: 'arrow-right',
    shortcut: 'Mod+Tab',
    run: () => tabs.step(1),
  },
  {
    id: 'shell.previousTab',
    labelKey: 'shell.command.previousTab',
    icon: 'arrow-left',
    shortcut: 'Mod+Shift+Tab',
    run: () => tabs.step(-1),
  },
  {
    id: 'shell.help',
    labelKey: 'shell.help.open',
    hintKey: 'shell.help.openHint',
    menuKey: HELP,
    groupKey: 'shell.help.manual',
    explained: true,
    icon: 'book-open',
    shortcut: 'F1',
    primary: true,
    // The commands of the tab in front go along: once Help is in front, that tab has put its own away.
    run: () => openHelp(commandRegistry.list()),
  },
  {
    id: 'shell.about',
    labelKey: 'shell.help.about',
    hintKey: 'shell.help.aboutHint',
    menuKey: HELP,
    groupKey: 'shell.help.manual',
    icon: 'circle-info',
    run: () => openHelp(commandRegistry.list(), true),
  },
  {
    id: 'shell.feedback',
    labelKey: 'shell.help.feedback',
    hintKey: 'shell.help.feedbackHint',
    menuKey: HELP,
    groupKey: 'shell.help.feedback',
    explained: true,
    icon: 'feedback',
    run: () => openSitePage('feedback'),
  },
  {
    id: 'shell.support',
    labelKey: 'shell.donate.button',
    hintKey: 'shell.donate.hint',
    menuKey: HELP,
    groupKey: 'shell.donate.label',
    explained: true,
    icon: 'support',
    run: () => openSitePage('support'),
  },
];

/** The keys the program's own commands have as it ships, by command id: those the user can give others in Settings. */
export const DEFAULT_SHELL_SHORTCUTS: Readonly<Record<string, string>> = Object.fromEntries(SHELL_COMMANDS.flatMap((command) => (command.shortcut ? [[command.id, command.shortcut]] : [])));

/** The shell's commands with the keys the user chose for them; an empty choice takes a command's keys away. */
function withChosenKeys(chosen: Readonly<Record<string, string>>): Command[] {
  return SHELL_COMMANDS.map((command) => {
    const keys = chosen[command.id];
    if (keys === undefined) return command;
    const { shortcut: _usual, ...rest } = command;
    return keys === '' ? rest : { ...rest, shortcut: keys };
  });
}

function createShellRegistry(): CommandRegistry {
  const registry = createCommandRegistry();
  let chosen = preferences.get().shortcuts;
  let remove = registry.registerAll(withChosenKeys(chosen));
  // Keys changed in Settings count from that moment on.
  preferences.subscribe(() => {
    const next = preferences.get().shortcuts;
    if (next === chosen) return;
    chosen = next;
    remove();
    remove = registry.registerAll(withChosenKeys(chosen));
  });
  return registry;
}

/** The one registry behind the menus, the ribbon, the side panel and the search. */
export const commandRegistry = createShellRegistry();
