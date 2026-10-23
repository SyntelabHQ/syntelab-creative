# command-registry

Each command is registered once and appears automatically in the ribbon, menu, side panel, search and shortcuts. Command labels are translation keys, so search works in every language.

## Modules

| File | Job |
|---|---|
| `src/command.ts` | The `Command` type |
| `src/registry.ts` | `createCommandRegistry`: register, list, execute, subscribe |
| `src/search.ts` | `searchCommands`: matches translated and English names, ignoring case and diacritics (`normalize`, also used by the shell's other searches) |
| `src/react/` | `useCommands` |

| `src/menu-model.ts` | `buildMenus`: commands by menu and group, the shape every layout draws |

A command can carry a menu, a group, an icon, an on/off state and a disabled
state. Shortcuts are not written yet.
