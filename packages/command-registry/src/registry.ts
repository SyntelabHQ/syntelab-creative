import type { Command } from './command';

export interface CommandRegistry {
  /** Adds a command and returns a function that removes it again. */
  register(command: Command): () => void;
  /**
   * Adds several commands at once (listeners hear about it once) and returns
   * a function that removes them all. Used for commands whose state changes:
   * remove the old set, add the new one.
   */
  registerAll(commands: readonly Command[]): () => void;
  get(id: string): Command | undefined;
  /** All commands in registration order. The array is replaced on every change. */
  list(): readonly Command[];
  /** Runs the command. A disabled command does nothing. */
  execute(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, Command>();
  const listeners = new Set<() => void>();
  let snapshot: readonly Command[] = [];

  const changed = () => {
    snapshot = [...commands.values()];
    for (const listener of listeners) listener();
  };

  const add = (command: Command) => {
    if (commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered`);
    }
    commands.set(command.id, command);
  };

  const remove = (command: Command): boolean => {
    if (commands.get(command.id) !== command) return false;
    commands.delete(command.id);
    return true;
  };

  return {
    register(command) {
      add(command);
      changed();
      return () => {
        if (remove(command)) changed();
      };
    },
    registerAll(added) {
      // Check first, so a duplicate leaves nothing half-registered.
      for (const command of added) {
        if (commands.has(command.id)) throw new Error(`Command "${command.id}" is already registered`);
      }
      added.forEach(add);
      if (added.length > 0) changed();
      return () => {
        if (added.map(remove).some(Boolean)) changed();
      };
    },
    get: (id) => commands.get(id),
    list: () => snapshot,
    async execute(id) {
      const command = commands.get(id);
      if (!command) throw new Error(`Unknown command "${id}"`);
      if (command.disabled) return;
      await command.run();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
