import { describe, expect, it } from 'vitest';
import type { Command } from './command';
import { buildMenus, orderMenus } from './menu-model';
import { createCommandRegistry } from './registry';

const command = (id: string, menuKey?: string, groupKey?: string): Command => ({
  id,
  labelKey: `${id}.label`,
  menuKey,
  groupKey,
  run: () => {},
});

describe('buildMenus', () => {
  it('groups by menu, then by group, in first-seen order', () => {
    const menus = buildMenus([
      command('open', 'file'),
      command('zoomIn', 'view', 'zoom'),
      command('rotate', 'view', 'rotate'),
      command('zoomOut', 'view', 'zoom'),
      command('searchOnly'),
    ]);

    expect(menus.map((menu) => menu.menuKey)).toEqual(['file', 'view']);
    expect(menus[1]?.groups.map((group) => [group.groupKey, group.commands.map((c) => c.id)])).toEqual([
      ['zoom', ['zoomIn', 'zoomOut']],
      ['rotate', ['rotate']],
    ]);
    expect(menus[0]?.groups[0]?.groupKey).toBe('');
  });
});

describe('orderMenus', () => {
  it('puts the first menus first, the last ones last, and the rest between', () => {
    const menus = buildMenus([command('a', 'help'), command('b', 'extra'), command('c', 'view'), command('d', 'file')]);
    expect(orderMenus(menus, ['file', 'view'], ['help']).map((menu) => menu.menuKey)).toEqual([
      'file',
      'view',
      'extra',
      'help',
    ]);
  });
});

describe('registerAll', () => {
  it('adds and removes a set with one notification each', () => {
    const registry = createCommandRegistry();
    let notifications = 0;
    registry.subscribe(() => notifications++);

    const remove = registry.registerAll([command('a'), command('b')]);
    expect(registry.list().map((c) => c.id)).toEqual(['a', 'b']);
    expect(notifications).toBe(1);

    remove();
    expect(registry.list()).toEqual([]);
    expect(notifications).toBe(2);
  });

  it('registers nothing when one id is taken', () => {
    const registry = createCommandRegistry();
    registry.register(command('b'));
    expect(() => registry.registerAll([command('a'), command('b')])).toThrow('already registered');
    expect(registry.get('a')).toBeUndefined();
  });

  it('does not run a disabled command', async () => {
    const registry = createCommandRegistry();
    let runs = 0;
    registry.register({ ...command('a'), disabled: true, run: () => void runs++ });
    await registry.execute('a');
    expect(runs).toBe(0);
  });
});
