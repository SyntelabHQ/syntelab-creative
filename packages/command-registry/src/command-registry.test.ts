import { describe, expect, it, vi } from 'vitest';
import type { Command } from './command';
import { createCommandRegistry } from './registry';
import { searchCommands } from './search';

const command = (id: string, run: Command['run'] = () => {}): Command => ({
  id,
  labelKey: `${id}.label`,
  run,
});

describe('createCommandRegistry', () => {
  it('registers, lists, executes and unregisters commands', async () => {
    const registry = createCommandRegistry();
    const run = vi.fn();
    const unregister = registry.register(command('shell.a', run));
    registry.register(command('shell.b'));

    expect(registry.list().map((c) => c.id)).toEqual(['shell.a', 'shell.b']);
    await registry.execute('shell.a');
    expect(run).toHaveBeenCalledOnce();

    unregister();
    expect(registry.get('shell.a')).toBeUndefined();
    await expect(registry.execute('shell.a')).rejects.toThrow('Unknown command');
  });

  it('refuses duplicate ids', () => {
    const registry = createCommandRegistry();
    registry.register(command('shell.a'));
    expect(() => registry.register(command('shell.a'))).toThrow('already registered');
  });

  it('notifies subscribers and replaces the list on change', () => {
    const registry = createCommandRegistry();
    const listener = vi.fn();
    const before = registry.list();
    registry.subscribe(listener);
    registry.register(command('shell.a'));
    expect(listener).toHaveBeenCalledOnce();
    expect(registry.list()).not.toBe(before);
  });
});

describe('searchCommands', () => {
  const commands = [command('shell.openSettings'), command('shell.themeDark'), command('shell.goToStart')];
  const labels: Record<string, string[]> = {
    'shell.openSettings': ['Deschide Setările', 'Open Settings'],
    'shell.themeDark': ['Folosește tema întunecată', 'Use dark theme'],
    'shell.goToStart': ['Mergi la Start', 'Go to Start'],
  };
  const labelsOf = (c: Command) => labels[c.id] ?? [];
  const search = (query: string) => searchCommands(commands, query, labelsOf).map((c) => c.id);

  it('matches the translated name and the English name', () => {
    expect(search('tema')).toEqual(['shell.themeDark']);
    expect(search('dark')).toEqual(['shell.themeDark']);
  });

  it('ignores case and diacritics', () => {
    expect(search('setarile')).toEqual(['shell.openSettings']);
    expect(search('INTUNECATA')).toEqual(['shell.themeDark']);
  });

  it('needs every word and ranks prefix matches first', () => {
    expect(search('use theme')).toEqual(['shell.themeDark']);
    expect(search('use light')).toEqual([]);
    expect(search('s')[0]).toBe('shell.openSettings');
    expect(search('go')).toEqual(['shell.goToStart']);
    expect(search('   ')).toEqual([]);
  });
});
