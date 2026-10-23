import { describe, expect, it } from 'vitest';
import type { Command } from './command';
import { findByShortcut, formatShortcut, shortcutOfKeyPress } from './shortcut';
import type { KeyPress } from './shortcut';

const press = (key: string, modifiers: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe('shortcutOfKeyPress', () => {
  it('reads letters with their modifiers', () => {
    expect(shortcutOfKeyPress(press('s', { ctrlKey: true }), false)).toBe('Mod+S');
    expect(shortcutOfKeyPress(press('S', { ctrlKey: true, shiftKey: true }), false)).toBe('Mod+Shift+S');
    expect(shortcutOfKeyPress(press('z', { metaKey: true }), true)).toBe('Mod+Z');
    // Ctrl is not the command key on a Mac.
    expect(shortcutOfKeyPress(press('z', { ctrlKey: true }), true)).toBe('Z');
  });

  it('treats "+" and the numeric keypad like "="', () => {
    expect(shortcutOfKeyPress(press('=', { ctrlKey: true }), false)).toBe('Mod+=');
    expect(shortcutOfKeyPress(press('+', { ctrlKey: true, shiftKey: true }), false)).toBe('Mod+=');
    expect(shortcutOfKeyPress(press('+', { ctrlKey: true, code: 'NumpadAdd' }), false)).toBe('Mod+=');
    expect(shortcutOfKeyPress(press('-', { ctrlKey: true, code: 'NumpadSubtract' }), false)).toBe('Mod+-');
  });

  it('reads named keys, and nothing from a modifier alone', () => {
    expect(shortcutOfKeyPress(press('F11'), false)).toBe('F11');
    expect(shortcutOfKeyPress(press('Delete', { shiftKey: true }), false)).toBe('Shift+Delete');
    expect(shortcutOfKeyPress(press('Control', { ctrlKey: true }), false)).toBeNull();
  });
});

describe('findByShortcut', () => {
  it('finds the command that declares the shortcut', () => {
    const commands: Command[] = [
      { id: 'a', labelKey: 'a', run: () => {} },
      { id: 'b', labelKey: 'b', shortcut: 'Mod+S', run: () => {} },
    ];
    expect(findByShortcut(commands, 'Mod+S')?.id).toBe('b');
    expect(findByShortcut(commands, 'Mod+Shift+S')).toBeUndefined();
  });
});

describe('formatShortcut', () => {
  it('writes shortcuts the way each system does', () => {
    expect(formatShortcut('Mod+Shift+S', false)).toBe('Ctrl+Shift+S');
    expect(formatShortcut('Mod+=', false)).toBe('Ctrl++');
    expect(formatShortcut('F11', false)).toBe('F11');
    expect(formatShortcut('Mod+Shift+S', true)).toBe('⇧⌘S');
  });
});
