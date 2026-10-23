# Units: backlog

Open work for Units. The steps of `PLAN.md` are built.

## Converters and data

- Check the English names written by hand where the source data had none (length, and the nine
  converters whose names are keys).
- Add conversion tests for more units: most converters are tested for only a few units each.

## Custom units

- A custom unit that no longer reads is dropped silently: the frontend receives the `refused` list
  (`frontend/engine/units-api.ts`) but nothing shows it to the user.

## Very large tables

- The memory a paste or import needs is not compared with free memory beforehand (the room is simply
  requested, and a refusal is reported).
- The clipboard text of a paste is held whole in memory; running out there cannot be handled gently.
- Writing CSV and Excel is slow for tens of millions of rows, because every cell is converted exactly.

## Testing in the app

- Not yet tried by hand: the file dialogs of import and export, and most converters one by one.
