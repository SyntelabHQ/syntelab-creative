import type { Command } from '@syntelab/command-registry';
import { TOOLS } from './tools/tool-definitions';
import type { ToolValues } from './tools/tool-definitions';

// Menus shared with the shell and other apps.
const FILE = 'common.menu.file';
const EDIT = 'common.menu.edit';
const VIEW = 'common.menu.view';
// …and the ones only Scribe has: each group of tools is a tool of the list on the side, with a bar of its own.
/** The menu (and the bar) of a group of tools. */
export const toolMenu = (toolGroup: string) => `scribe.menu.${toolGroup}`;
const COMPARE_MENU = toolMenu('compare');
/** The tools whose main choice is laid out in the bars, each of its options a command of its own: by tool, the choice. */
const LAID_OUT: Readonly<Record<string, string>> = { changeCase: 'to', quotes: 'to', reverseText: 'what', trimLines: 'side' };

const group = (name: string) => `scribe.group.${name}`;
const commandId = (name: string) => `scribe.${name}`;

/** The keys of the commands that have some, the same as in other editors. */
export const SHORTCUTS: Readonly<Record<string, string>> = {
  newText: 'Mod+N',
  open: 'Mod+O',
  save: 'Mod+S',
  saveAs: 'Mod+Shift+S',
  close: 'Mod+W',
  undo: 'Mod+Z',
  redo: 'Mod+Y',
  find: 'Mod+F',
  selectAll: 'Mod+A',
  wrap: 'Alt+Z',
  toolsPanel: 'Mod+T',
  findInFolder: 'Mod+Shift+F',
};

/** What the editor's tab knows and can do, for its commands. */
export interface EditorCommandsInput {
  readonly onNew: () => void;
  readonly onOpen: () => void;
  readonly onSave: () => void;
  readonly onSaveAs: () => void;
  readonly onReopen: () => void;
  readonly onClose: () => void;
  readonly onSettings: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onFind: () => void;
  readonly onSelectAll: () => void;
  readonly onWrap: () => void;
  readonly onLineNumbers: () => void;
  /** Shows or hides a part of the panel beside the text: the tools, the recipes, the statistics. */
  readonly onPart: (part: 'tools' | 'recipes' | 'stats') => void;
  /** Shows or hides the result of the open tool beside the text. */
  readonly onPreview: () => void;
  /** Opens the tools panel at a tool, with some of its choices already made when the command was of one of its variants. */
  readonly onTool: (id: string, preset?: ToolValues) => void;
  /** Compares this text with a file the user chooses. */
  readonly onCompareWithFile: () => void;
  /** Compares this text with another one, typed or pasted beside it. */
  readonly onCompareWithText: () => void;
  /** Opens a tab that compares two files. */
  readonly onCompareFiles: () => void;
  /** Opens a tab that compares two texts typed or pasted there. */
  readonly onCompareTexts: () => void;
  /** Opens the tab that finds and replaces in a folder. */
  readonly onFindInFolder: () => void;
  /** The text has changes that are not in its file. */
  readonly changed: boolean;
  /** The text has a file (it is not a new one). */
  readonly hasFile: boolean;
  /** Something is being read or written. */
  readonly busy: boolean;
  readonly wrap: boolean;
  readonly lineNumbers: boolean;
  /** The parts of the panel that are shown. */
  readonly panelParts: readonly string[];
  readonly previewShown: boolean;
  /** The tool whose choices are open in the panel: its button on the bar is pressed. */
  readonly openTool: string | null;
}

/** One command: its name, where it is in the menus, and what it does. */
function command(name: string, menuKey: string, groupName: string, icon: string, run: () => void, more: Partial<Command> = {}): Command {
  return { id: commandId(name), labelKey: `scribe.command.${name}`, hintKey: `scribe.hint.${name}`, shortcut: SHORTCUTS[name], menuKey, groupKey: group(groupName), icon, run, ...more };
}

/** What a tab without a text of its own (two texts compared, a folder searched) can do. */
export interface OtherTabCommandsInput {
  readonly onNew: () => void;
  readonly onOpen: () => void;
  readonly onCompareFiles: () => void;
  readonly onCompareTexts: () => void;
  readonly onFindInFolder: () => void;
  readonly onClose: () => void;
  readonly onSettings: () => void;
}

/** What such a tab can do, by the names of the commands; everything else a text's tab has is shown too, but not to be used. */
const IN_OTHER_TABS: readonly string[] = ['newText', 'open', 'close', 'settings', 'compareFiles', 'compareTexts', 'findInFolder'];

/**
 * The commands of a tab without a text of its own: the same menus as a text's tab, so nothing jumps when the
 * user goes from one to the other, with only what can be used there left to be used.
 */
export function otherTabCommands(input: OtherTabCommandsInput): Command[] {
  const nothing = () => {};
  const all = editorCommands({
    ...input,
    onSave: nothing,
    onSaveAs: nothing,
    onReopen: nothing,
    onUndo: nothing,
    onRedo: nothing,
    onFind: nothing,
    onSelectAll: nothing,
    onWrap: nothing,
    onLineNumbers: nothing,
    onPart: nothing,
    onPreview: nothing,
    onTool: nothing,
    onCompareWithFile: nothing,
    onCompareWithText: nothing,
    changed: false,
    hasFile: false,
    busy: false,
    wrap: false,
    lineNumbers: false,
    panelParts: [],
    previewShown: false,
    openTool: null,
  });
  const usable = new Set(IN_OTHER_TABS.map(commandId));
  return all.map((known) => (usable.has(known.id) ? known : { ...known, disabled: true, checked: undefined }));
}

/** The commands of a tab with a text in it. */
export function editorCommands(input: EditorCommandsInput): Command[] {
  const { busy } = input;
  return [
    command('newText', FILE, 'text', 'file-circle-plus', input.onNew, { primary: true }),
    command('open', FILE, 'text', 'folder-open', input.onOpen, { primary: true, disabled: busy }),
    command('save', FILE, 'text', 'floppy-disk', input.onSave, { primary: true, disabled: busy || (input.hasFile && !input.changed) }),
    command('saveAs', FILE, 'text', 'file-arrow-down', input.onSaveAs, { disabled: busy }),
    command('reopen', FILE, 'text', 'rotate', input.onReopen, { disabled: busy || !input.hasFile }),
    command('close', FILE, 'text', 'xmark', input.onClose),
    command('settings', FILE, 'text', 'gear', input.onSettings),

    command('undo', EDIT, 'history', 'arrow-rotate-left', input.onUndo, { primary: true }),
    command('redo', EDIT, 'history', 'arrow-rotate-right', input.onRedo, { primary: true }),
    command('find', EDIT, 'find', 'magnifying-glass', input.onFind, { primary: true }),
    command('selectAll', EDIT, 'find', 'check-double', input.onSelectAll),

    command('wrap', VIEW, 'text', 'arrows-left-right', input.onWrap, { kind: 'toggle', checked: input.wrap }),
    command('lineNumbers', VIEW, 'text', 'list-ol', input.onLineNumbers, { kind: 'toggle', checked: input.lineNumbers }),
    command('preview', VIEW, 'text', 'table-columns', input.onPreview, { kind: 'toggle', checked: input.previewShown }),
    // What stands beside the text: each part is there or it is not; with none, there is no panel.
    command('toolsPanel', VIEW, 'panel', 'sliders', () => input.onPart('tools'), { kind: 'toggle', checked: input.panelParts.includes('tools') }),
    // The recipes and the statistics are tools of the list on the side too: one click shows them (or puts them away).
    command('recipes', toolMenu('recipes'), 'panel', 'list-check', () => input.onPart('recipes'), { kind: 'toggle', checked: input.panelParts.includes('recipes') }),
    command('stats', toolMenu('stats'), 'panel', 'ruler', () => input.onPart('stats'), { kind: 'toggle', checked: input.panelParts.includes('stats') }),
    // Every tool is a command too: found by the search, on the bar of its group; it opens the panel at its choices.
    ...toolCommands(input.onTool, input.openTool),
    command('findInFolder', toolMenu('replace'), 'folder', 'folder-tree', input.onFindInFolder, { primary: true }),

    command('compareWithFile', COMPARE_MENU, 'compare', 'code-compare', input.onCompareWithFile, { primary: true }),
    command('compareWithText', COMPARE_MENU, 'compare', 'paste', input.onCompareWithText, { primary: true }),
    command('compareFiles', COMPARE_MENU, 'compare', 'right-left', input.onCompareFiles, { primary: true }),
    command('compareTexts', COMPARE_MENU, 'compare', 'pen-to-square', input.onCompareTexts, { primary: true }),
  ];
}

/** The tools as commands, each on the bar of its group; the one open in the panel is pressed. */
function toolCommands(onTool: (id: string, preset?: ToolValues) => void, openTool: string | null): Command[] {
  return TOOLS.flatMap((tool): Command[] => {
    const laidOut = tool.fields.find((field) => field.name === LAID_OUT[tool.id]);
    // A tool that is mostly one choice is shown as its options: "ALL CAPITALS" is a click, not a tool and then a list.
    if (laidOut?.kind === 'choice') {
      return laidOut.options.map(
        (option): Command => ({
          id: commandId(`tool.${tool.id}.${option}`),
          labelKey: `scribe.variant.${tool.id}.${option}`,
          hintKey: `scribe.toolHint.${tool.id}`,
          menuKey: toolMenu(tool.group),
          groupKey: `scribe.toolGroup.${tool.group}`,
          icon: tool.icon,
          primary: true,
          run: () => onTool(tool.id, { [laidOut.name]: option }),
        }),
      );
    }
    return [toolCommand(tool, openTool === tool.id, onTool)];
  });
}

function toolCommand(tool: (typeof TOOLS)[number], open: boolean, onTool: (id: string) => void): Command {
  return (
    {
      id: commandId(`tool.${tool.id}`),
      labelKey: `scribe.tool.${tool.id}`,
      hintKey: `scribe.toolHint.${tool.id}`,
      menuKey: toolMenu(tool.group),
      groupKey: `scribe.toolGroup.${tool.group}`,
      icon: tool.icon,
      primary: true,
      kind: 'choice',
      checked: open,
      run: () => onTool(tool.id),
    }
  );
}
