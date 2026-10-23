import { buildMenus, orderMenus, useCommands } from '@syntelab/command-registry';
import type { Command, CommandMenu } from '@syntelab/command-registry';
import type { Translate } from '@syntelab/i18n';
import { useMemo } from 'react';
import { commandRegistry, FIRST_MENUS, LAST_MENUS, shortcutLabel } from '../commands';

/** Every registered command, arranged by menu and group, for the layouts. */
export function useMenus(): CommandMenu[] {
  const commands = useCommands(commandRegistry);
  return useMemo(() => orderMenus(buildMenus(commands), FIRST_MENUS, LAST_MENUS), [commands]);
}

/** The commands that get a button of their own (toolbar, collapsed panel), by menu. */
export function primaryCommands(menus: readonly CommandMenu[]): Command[][] {
  return menus
    .map((menu) => menu.groups.flatMap((group) => group.commands.filter((command) => command.primary && command.icon)))
    .filter((commands) => commands.length > 0);
}

/**
 * The text of a command's tooltip: what it does, also while it cannot be
 * used (no document is open, nothing is selected). A command that is not
 * written yet says so after that. Undefined when there is nothing to add to
 * its name.
 */
export function commandHint(command: Command, t: Translate): string | undefined {
  const hint = command.hintKey ? t(command.hintKey) : undefined;
  if (!command.comingSoon) return hint;
  return t('shell.command.notYet', { hint: hint ?? t(command.labelKey) });
}

/**
 * The tooltip of a command's button: what it does (or, when `named`, at least
 * its name), followed by its shortcut. Undefined when there is nothing to say.
 */
export function commandTooltip(command: Command, t: Translate, named: boolean): string | undefined {
  const shortcut = command.comingSoon ? undefined : shortcutLabel(command);
  const text = commandHint(command, t) ?? (named || shortcut ? t(command.labelKey) : undefined);
  return text && shortcut ? `${text} (${shortcut})` : text;
}

export function runCommand(command: Command): void {
  void commandRegistry.execute(command.id);
}
