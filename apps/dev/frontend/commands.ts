import type { Command } from '@syntelab/command-registry';
import type { ToolActions } from './frame/text-tool';
import { TOOLS } from './tools/catalog';

// Menus shared with the shell and other apps.
const FILE = 'common.menu.file';
const VIEW = 'common.menu.view';

const commandId = (name: string) => `dev.${name}`;

const SHORTCUTS: Readonly<Record<string, string>> = {
  open: 'Mod+O',
  save: 'Mod+S',
  run: 'Mod+Enter',
  close: 'Mod+W',
};

export interface DevCommandsInput {
  /** The tool that is open; null on the first page. */
  readonly openTool: string | null;
  /** What the commands do with the tool that is open; null when it is not built, or on the first page. */
  readonly actions: ToolActions | null;
  /** What goes in and what comes out stand side by side; else one over the other. */
  readonly sideBySide: boolean;
  readonly onSideBySide: () => void;
  /** The editors show the number of each line. */
  readonly lineNumbers: boolean;
  readonly onLineNumbers: () => void;
  /** A line too long for its pane goes on on the next row. */
  readonly wrap: boolean;
  readonly onWrap: () => void;
  /** The tool that is open is among the pinned ones. */
  readonly pinned: boolean;
  readonly onPin: () => void;
  readonly onTool: (id: string) => void;
  /** Goes back to the first page. */
  readonly onStart: () => void;
  readonly onClose: () => void;
}

/** The commands of a Dev tab: File, View, and the tools under their menus. */
export function devCommands(input: DevCommandsInput): Command[] {
  const { actions } = input;
  const idle = actions === null;
  return [
    // The first page of Dev. In no menu of its own: "Go to Start" of the File menu, which the shell puts there, runs it
    // (the shell looks for a command named `<app-id>.start`). The search finds it by its name too.
    { id: commandId('start'), labelKey: 'dev.command.start', hintKey: 'dev.hint.start', icon: 'house', run: input.onStart },
    { id: commandId('open'), labelKey: 'dev.command.open', hintKey: 'dev.hint.open', shortcut: SHORTCUTS.open, menuKey: FILE, groupKey: 'dev.group.file', icon: 'folder-open', primary: true, disabled: idle, run: () => actions?.open() },
    { id: commandId('save'), labelKey: 'dev.command.save', hintKey: 'dev.hint.save', shortcut: SHORTCUTS.save, menuKey: FILE, groupKey: 'dev.group.file', icon: 'floppy-disk', primary: true, disabled: idle, run: () => actions?.save() },
    { id: commandId('close'), labelKey: 'dev.command.close', hintKey: 'dev.hint.close', shortcut: SHORTCUTS.close, menuKey: FILE, groupKey: 'dev.group.file', icon: 'xmark', run: input.onClose },

    { id: commandId('run'), labelKey: 'dev.command.run', hintKey: 'dev.hint.run', shortcut: SHORTCUTS.run, menuKey: FILE, groupKey: 'dev.group.tool', icon: 'bolt', primary: true, disabled: idle, run: () => actions?.run() },
    { id: commandId('copy'), labelKey: 'dev.command.copy', hintKey: 'dev.hint.copy', menuKey: FILE, groupKey: 'dev.group.tool', icon: 'copy', disabled: idle, run: () => actions?.copy() },
    { id: commandId('burn'), labelKey: 'dev.command.burn', hintKey: 'dev.hint.burn', menuKey: FILE, groupKey: 'dev.group.tool', icon: 'trash-can', disabled: idle, run: () => actions?.burn() },

    { id: commandId('sideBySide'), labelKey: 'dev.command.sideBySide', hintKey: 'dev.hint.sideBySide', menuKey: VIEW, groupKey: 'dev.group.tool', icon: 'table-columns', kind: 'toggle', checked: input.sideBySide, run: input.onSideBySide },
    { id: commandId('lineNumbers'), labelKey: 'dev.command.lineNumbers', hintKey: 'dev.hint.lineNumbers', menuKey: VIEW, groupKey: 'dev.group.tool', icon: 'list-ol', kind: 'toggle', checked: input.lineNumbers, run: input.onLineNumbers },
    { id: commandId('wrap'), labelKey: 'dev.command.wrap', hintKey: 'dev.hint.wrap', menuKey: VIEW, groupKey: 'dev.group.tool', icon: 'paragraph', kind: 'toggle', checked: input.wrap, run: input.onWrap },
    // The frame of a tool has no head any more: its pin is here, and on the first page.
    { id: commandId('pin'), labelKey: 'dev.command.pin', hintKey: 'dev.hint.pin', menuKey: VIEW, groupKey: 'dev.group.tool', icon: 'bookmark', kind: 'toggle', checked: input.pinned, disabled: input.openTool === null, run: input.onPin },

    // Each tool under its menu, in the order of the catalog. One that is put off stands in its place and cannot be chosen.
    ...TOOLS.map(
      (tool): Command => ({
        id: commandId(`tool.${tool.id}`),
        labelKey: `dev.tool.${tool.id}`,
        hintKey: tool.later ? 'dev.hint.later' : `dev.about.${tool.id}`,
        menuKey: `dev.menu.${tool.group}`,
        groupKey: 'dev.group.tools',
        icon: tool.icon,
        kind: 'toggle',
        checked: input.openTool === tool.id,
        disabled: tool.later,
        comingSoon: tool.later,
        run: () => input.onTool(tool.id),
      }),
    ),
  ];
}
