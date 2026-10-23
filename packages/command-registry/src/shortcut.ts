import type { Command } from './command';

/** The part of a keyboard event a shortcut is read from. */
export interface KeyPress {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const NUMPAD: Readonly<Record<string, string>> = { NumpadAdd: '=', NumpadSubtract: '-' };
/** What Shift turns a key into counts as the key itself: Ctrl and "+" is Ctrl and "=". */
const SHIFTED: Readonly<Record<string, string>> = { '+': '=', _: '-' };

/**
 * The shortcut a key press stands for, written the way commands declare
 * theirs (`Mod+Shift+S`), or null for a press of a modifier key alone.
 */
export function shortcutOfKeyPress(press: KeyPress, isMac: boolean): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(press.key)) return null;
  const symbol = NUMPAD[press.code ?? ''] ?? SHIFTED[press.key] ?? press.key;
  const isLetter = symbol.length === 1 && symbol.toLowerCase() !== symbol.toUpperCase();
  // Shift only counts with letters and named keys; with a symbol it is how the symbol is typed.
  const shift = press.shiftKey && (isLetter || symbol.length > 1);
  const mod = isMac ? press.metaKey : press.ctrlKey;
  const key = symbol.length === 1 ? symbol.toUpperCase() : symbol;
  return [mod && 'Mod', press.altKey && 'Alt', shift && 'Shift', key].filter(Boolean).join('+');
}

/** The first command that declares the shortcut. Planned commands keep theirs reserved. */
export function findByShortcut(commands: readonly Command[], shortcut: string): Command | undefined {
  return commands.find((command) => command.shortcut === shortcut);
}

const MAC_SYMBOLS: Readonly<Record<string, string>> = { Mod: '⌘', Alt: '⌥', Shift: '⇧' };
const KEY_NAMES: Readonly<Record<string, string>> = { '=': '+' };

/** A shortcut as people read it: `Ctrl+Shift+S`, or `⇧⌘S` on a Mac. */
export function formatShortcut(shortcut: string, isMac: boolean): string {
  const parts = shortcut.split('+').map((part) => KEY_NAMES[part] ?? part);
  if (!isMac) return parts.map((part) => (part === 'Mod' ? 'Ctrl' : part)).join('+');
  const key = parts[parts.length - 1] ?? '';
  const modifiers = parts.slice(0, -1);
  // Apple's order: Option, Shift, Command.
  const order = ['Alt', 'Shift', 'Mod'];
  return order.filter((modifier) => modifiers.includes(modifier)).map((modifier) => MAC_SYMBOLS[modifier]).join('') + key;
}
