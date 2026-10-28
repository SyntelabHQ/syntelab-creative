import { findByShortcut, formatShortcut, shortcutOfKeyPress } from '@syntelab/command-registry';
import type { Command } from '@syntelab/command-registry';
import { useEffect } from 'react';
import { commandRegistry } from './shell-commands';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** Shortcuts a text field needs for itself: undo, redo, select all, copy, paste, cut. */
const TEXT_EDITING = new Set(['Mod+Z', 'Mod+Y', 'Mod+Shift+Z', 'Mod+A', 'Mod+C', 'Mod+V', 'Mod+X']);

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Keys as the user reads them on this computer: `Mod+K` is `Ctrl+K`, or `⌘K` on a Mac. */
export function shortcutText(shortcut: string): string {
  return formatShortcut(shortcut, IS_MAC);
}

/** A command's shortcut as the user reads it (`Ctrl+S`), or undefined. */
export function shortcutLabel(command: Command): string | undefined {
  return command.shortcut ? formatShortcut(command.shortcut, IS_MAC) : undefined;
}

/**
 * Runs the command whose shortcut was pressed. A shortcut that belongs to a
 * command never falls through to the web view (no page reload, no print
 * window of its own), even while that command is disabled.
 */
function onKeyDown(event: KeyboardEvent): void {
  // Something closer to the keys already used them, or a window is asking a question.
  if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
  const shortcut = shortcutOfKeyPress(event, IS_MAC);
  if (!shortcut) return;
  if (isTextField(event.target) && (!shortcut.startsWith('Mod+') || TEXT_EDITING.has(shortcut))) return;

  const command = findByShortcut(commandRegistry.list(), shortcut);
  if (!command) return;
  event.preventDefault();
  void commandRegistry.execute(command.id);
}

/** Listens for command shortcuts while the main window is shown. */
export function useCommandShortcuts(): void {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
