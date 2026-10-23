import type { Command } from '@syntelab/command-registry';
import { converterIcon } from './engine/converter-icons';
import { CATEGORIES, COMING } from './engine/units-api';
import type { ConverterEntry } from './engine/units-api';

// Menus shared with the shell and other apps.
const FILE = 'common.menu.file';
const VIEW = 'common.menu.view';
/** A menu for each of the six categories: its converters and nothing else. */
const menuOf = (category: string) => `units.menu.${category}`;

const commandId = (name: string) => `units.${name}`;

const SHORTCUTS: Readonly<Record<string, string>> = {
  close: 'Mod+W',
};

export interface UnitsCommandsInput {
  /** The converters the program has, as the Rust side lists them. */
  readonly converters: readonly ConverterEntry[];
  /** The converter that is open; null on the smart converter. */
  readonly openConverter: string | null;
  readonly rowNumbers: boolean;
  /** Values too large or too small to read at a glance are written in full instead of with a power of ten. */
  readonly extremesInFull: boolean;
  readonly panelShown: boolean;
  readonly onRowNumbers: () => void;
  readonly onExtremes: () => void;
  readonly onPanel: () => void;
  readonly onConverter: (id: string) => void;
  /** Goes back to the first page. */
  readonly onSmart: () => void;
  readonly onClose: () => void;
}

function command(name: string, menuKey: string, groupName: string, icon: string, run: () => void, more: Partial<Command> = {}): Command {
  return { id: commandId(name), labelKey: `units.command.${name}`, hintKey: `units.hint.${name}`, shortcut: SHORTCUTS[name], menuKey, groupKey: `units.group.${groupName}`, icon, run, ...more };
}

/** The commands of a Units tab: File, View, and the converters under their categories. */
export function unitsCommands(input: UnitsCommandsInput): Command[] {
  return [
    // The first page of Units. In no menu of its own: "Go to Start" of the File menu, which the shell puts there, runs it
    // (the shell looks for a command named `<app-id>.start`). The search finds it by its name too.
    { id: commandId('start'), labelKey: 'units.command.smart', hintKey: 'units.hint.smart', icon: 'house', run: input.onSmart },
    command('close', FILE, 'file', 'xmark', input.onClose),

    // What the table shows: these wait for a table to be open.
    command('unitsPanel', VIEW, 'table', 'ruler-combined', input.onPanel, { kind: 'toggle', checked: input.panelShown, disabled: input.openConverter === null }),
    command('rowNumbers', VIEW, 'table', 'list-ol', input.onRowNumbers, { kind: 'toggle', checked: input.rowNumbers, disabled: input.openConverter === null }),
    command('extremesInFull', VIEW, 'table', 'expand', input.onExtremes, { kind: 'toggle', checked: input.extremesInFull }),

    // In the order of the categories, then as the Rust side lists them. In the menus only: thirty-eight are too many for a bar of icons.
    ...CATEGORIES.flatMap((category) =>
      input.converters
        .filter((known) => known.category === category)
        .map(
          (known): Command => ({
            id: commandId(`converter.${known.id}`),
            labelKey: `units.converter.${known.id}`,
            hintKey: 'units.hint.converter',
            menuKey: menuOf(category),
            groupKey: 'units.group.converters',
            icon: converterIcon(known.icon),
            kind: 'toggle',
            checked: input.openConverter === known.id,
            run: () => input.onConverter(known.id),
          }),
        )
        // Those that are not built yet stand in their place, and cannot be chosen.
        .concat(
          COMING.filter((coming) => coming.category === category && !input.converters.some((known) => known.id === coming.id)).map(
            (coming): Command => ({ id: commandId(`converter.${coming.id}`), labelKey: `units.converter.${coming.id}`, hintKey: 'units.hint.comingSoon', menuKey: menuOf(category), groupKey: 'units.group.converters', icon: converterIcon(coming.icon), disabled: true, comingSoon: true, run: () => {} }),
          ),
        ),
    ),
  ];
}
