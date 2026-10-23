import { useSyncExternalStore } from 'react';
import type { Command } from '../command';
import type { CommandRegistry } from '../registry';

/** The registry's commands, re-rendering when one is added or removed. */
export function useCommands(registry: CommandRegistry): readonly Command[] {
  return useSyncExternalStore(registry.subscribe, registry.list);
}
