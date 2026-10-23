import type { Command, CommandMenu } from '@syntelab/command-registry';
import { useTranslation } from '@syntelab/i18n';
import { MenuButton } from '@syntelab/ui-kit';
import type { MenuItem, MenuSection } from '@syntelab/ui-kit';
import { CommandButton } from '../command-button';
import { shortcutLabel } from '../../commands';
import { commandHint, primaryCommands, runCommand } from '../use-menus';
import styles from './classic-bars.module.css';

export interface ClassicBarsProps {
  readonly menus: readonly CommandMenu[];
}

/** The classic layout: a menu bar with every command, and a toolbar with the main ones. */
export function ClassicBars({ menus }: ClassicBarsProps) {
  const t = useTranslation();

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

  const toSections = (menu: CommandMenu): MenuSection[] =>
    menu.groups.map((group) => ({ id: group.groupKey, items: group.commands.map(toItem) }));

  return (
    <div className={styles.bars}>
      <div role="menubar" aria-label={t('shell.layout.menuBar')} className={styles.menuBar}>
        {menus.map((menu) => (
          <MenuButton key={menu.menuKey} variant="text" align="start" label={t(menu.menuKey)} sections={toSections(menu)} />
        ))}
      </div>
      <div role="toolbar" aria-label={t('shell.layout.tools')} className={styles.toolbar}>
        {primaryCommands(menus).map((commands, index) => (
          <div key={commands[0]?.id ?? index} className={styles.toolGroup}>
            {commands.map((command) => (
              <CommandButton key={command.id} command={command} shape="icon" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
