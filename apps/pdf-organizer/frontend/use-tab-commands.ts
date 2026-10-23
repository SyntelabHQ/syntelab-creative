import type { Command } from '@syntelab/command-registry';
import { useTabCommands as useCommandsOfTab } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { useMemo } from 'react';
import { withChosenShortcuts } from './commands';
import { useOrganizerSettings } from './settings/organizer-settings';

/**
 * Keeps the commands of this tab in the program while the tab is in front,
 * with the keys the user chose for them in the app's settings.
 * Pass a memoized array: a new array replaces the registered commands.
 */
export function useTabCommands(host: AppHost, commands: readonly Command[]): void {
  const { shortcuts } = useOrganizerSettings(host);
  const withKeys = useMemo(() => withChosenShortcuts(commands, shortcuts), [commands, shortcuts]);
  useCommandsOfTab(host, withKeys);
}
