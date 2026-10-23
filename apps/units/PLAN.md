# Units — Plan

Unit converters: one value converted quickly, or whole tables of values
converted between the units of a converter at once. Everything is computed on
the user's computer; only currency rates are fetched (see "Currency").

Decided with the owner on 2026-10-11. The web version (`units.skalda.io`)
is the model for what the app does; none of its code is copied.

Colour `#E53935`. Icon `assets/icon.svg`.

## 1. What the app is

- **Smart converter**: the first page. One value, its unit, and the results
  in the pinned units of the converter.
- **Table**: a grid where every column is a unit and every row a value. The
  cell that is typed in drives its row; the other columns are computed from it.
- **38 converters** in six categories, about 1,590 units (the list of the
  model):
  - Essentials: length, weight and mass, temperature, volume, area, time,
    currency.
  - Motion and mechanics: speed, fuel economy, acceleration, force, torque,
    pressure.
  - Energy and power: energy, power, electric charge, voltage, electric
    current, electrical resistance.
  - Scientific: density, frequency, angle, concentration, metric prefixes,
    light, flow.
  - Digital and media: data storage, data transfer, image resolution,
    typography, sound, number base.
  - Specialized physics: heat transfer, viscosity, surface tension,
    permeability, magnetic field, radiation.
- Not in the app: the calculators and the articles of the web version.

## 2. One tab

- Everything happens in the tab of Units. A setting chooses between "stay in
  the same tab" (as it ships) and "open each converter in a tab of its own".
- In the same tab, going to another converter while the table has values
  asks first: Continue (the values are lost), Open in a new tab, Cancel. It is
  never asked for the smart converter, nor for an empty table.

## 3. Menus (ribbon, classic, side panel)

- **File**, **View**, the six categories, and Help (put there by the shell).
- A category holds its converters and nothing else: each an icon and a name.
  Choosing one loads its units and shows the table.
- **View**: show the smart converter (back to the first page); the units
  panel; row numbers; how extreme values are written (scientific, or in full);
  the usual layout choices.
- The commands of the table are not in the menus: see the bar (5).

## 4. Smart converter (first page)

- Seven tabs, the essentials: length, weight and mass, temperature, volume,
  area, time, currency. No reordering or hiding of tabs in the first version.
- A value and its unit on one side; on the other, the results, a line each:
  value, symbol, copy, pin.
- **Pins**: a unit is pinned as a favourite. Pinned units come first in the
  results, first in the units panel, and are the columns a table starts with.
- "Open in the table" takes the value and the units shown to the table.
- It goes away when a converter is chosen; View brings it back.
- The same engine, units and precision as the table: it is one row laid out
  another way, not a second converter.

## 5. Table

- **The bar**: always over the head of the table, in a shade of its own,
  whatever the layout: undo, redo; copy and paste (also transposed); import
  (Excel, CSV, TSV; also transposed; the kind found by itself); export (Excel,
  CSV, TSV, text, JSON; also transposed); clear the selection; clear all; and
  the options: how a column is titled (name (symbol), name, symbol), include
  the titles, include row numbers, convert the other units after a paste or
  an import, reset the converter.
- **Units panel**, at the side, can be folded: search, the groups of the
  converter as filters (SI, imperial, astronomical…), popular units, pinned
  first. A click adds a unit as a column or takes it out.
- **Columns**: width dragged; a menu on each: move left, move right, pin
  left, pin right, precision, remove. The precision of a column changes that
  column only, never the default of its unit.
- **Selection**, as in a spreadsheet: the corner (#) selects all, a row number
  its row, a head its column; Shift+click a range, Ctrl+click cell by cell;
  dragging.
- **Editing**: double click, or typing on the active cell; arrows, Tab and
  Enter move.
- **Status line**: rows, columns, what is selected, the last action; for
  currency, when the rates were taken.
- **Large tables**: only the rows in sight are drawn. The model converted
  five million values at once; the app must do no worse. What is typed is
  kept on the Rust side; the other columns are computed for what is in sight,
  and for all of it on copy and export. Import and export read and write in
  pieces.

## 6. Units, as data

- A unit: id, name, symbol, other names (for the search), group, popular or
  not, and how it becomes the base unit of its converter: a factor, or a
  formula both ways where the scale has an offset (Celsius, Fahrenheit).
- Units are data files read by one engine, not code repeated for each
  converter.
- Names through the suite's translations; the other names feed the search.
- Number bases answer with text (binary, hexadecimal, Roman, BCD, Gray code).

## 6a. Custom units (in the first version)

- A unit of the user's own belongs to a converter: it is said by a unit that
  exists (1 pace = 0.75 m), so it converts to every other unit of it.
- Made and found in the units panel of that converter: a group "Mine" among
  the filters, with "New unit"; then it is a unit like any other (a column,
  a pin, a precision).
- All of them, of every converter, are listed in the settings of Units, to
  be changed, removed, exported and imported.
- How it is said, both ways offered (owner, 2026-10-11): the usual way, a
  factor with an offset where the scale needs one, which the program turns
  around exactly; and the advanced way, a free formula with its way back
  written too. No formula is ever run as code.

## 7. Precision

- It belongs to the unit a value arrives in, not to how many digits were
  typed: 5 cm is 1.97 in.
- **Default decimals for each unit** (centimetre 1, inch 2, kilometre 3,
  money 2…), from the model where it has a clear answer.
- **A floor for extreme values**: a result always shows a few significant
  digits, so a very small value is never shown as 0; beyond that, scientific
  notation or the value in full, as View says.
- Exceptions written by hand only where they are real (Gas Mark).
- **Settings**: the precision of each unit can be changed. Over it, the
  precision chosen for a column of the table.
- What the user typed is kept as typed ("2.00" stays "2.00").
- To be measured when built: exact arithmetic (so "in full" shows true
  digits) against the speed of millions of rows.

## 8. Numbers typed and pasted

- Read by the language of the program: "1,234.56" and "1.234,56" are both
  understood, and an ambiguous one is said to be so instead of being read
  wrong in silence.

## 9. Currency

- Rates come from a free service online; the app says so where currency is
  used. Only the rates are asked for: nothing about the user or the amounts.
- Taken when currency is opened; refreshed by themselves while it is on
  screen, as often as the source changes (to be read in its terms), not at
  every conversion; nothing asked while the tab is at the back; refreshed on
  coming back when they are old. A button refreshes by hand.
- The time of the rates and their source are shown. Without a connection the
  last rates are used, marked as old.
- The connection is in `crates/syntelab-net`; decision 0004 gets a note.

## 10. Settings of Units

- Same tab or a tab for each converter.
- Precision for each unit.
- The units a converter starts with.
- Currency: the note about going online, how often rates are refreshed.

## 11. Order of work

Left to whoever builds it (owner, 2026-10-11). Each step ends with something
that can be tried in the program.

1. The engine in Rust with two converters (length, temperature): units as
   data, conversion, precision, reading numbers; tests against known values.
2. The app in the shell with the smart converter on those two: the first
   thing that can be used, and it proves the engine and the precision.
3. The table, small first (selection, editing, columns, the units panel),
   then drawing only what is in sight and the millions of rows.
4. The bar: undo, copy and paste, import and export, options.
5. The other 36 converters as data, a category at a time; the menus of the
   six categories; pins.
6. Custom units.
7. Currency.
8. Settings, the manual, translations (en, ro, ar first).

## 12. Not in the first version

- Reordering and hiding the tabs of the smart converter.

## 13. Open questions

- The terms of the two rate services (how often, how they are to be named).
- Libraries for reading and writing Excel files: licences to be checked.
- Whether the table belongs in the core, for other apps to use.
