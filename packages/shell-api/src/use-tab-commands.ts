import type { Command } from '@syntelab/command-registry';
import { useEffect } from 'react';
import type { AppHost } from './app-frontend';

/**
 * Keeps the commands of this tab in the program while the tab is in front.
 * Pass a memoized array: a new array replaces the registered commands.
 */
export function useTabCommands(host: Pick<AppHost, 'active' | 'registerCommands'>, commands: readonly Command[]): void {
  const { active, registerCommands } = host;
  useEffect(() => {
    if (!active) return;
    return registerCommands(commands);
  }, [active, registerCommands, commands]);
}
