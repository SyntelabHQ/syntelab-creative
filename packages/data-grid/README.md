# data-grid

The table of the suite: rows and columns of cells, drawn only where they are in sight, selected as in a spreadsheet,
and edited where the one who shows it lets it be. It knows nothing of what the cells mean: what they say comes from
`cell`, the rows in sight are asked for through `need`, and what is typed goes to `onCommit`. A table of millions
of rows is as light as one of ten.

Used by Units (the tables of its converters, edited) and by Dev (CSV looked at as a table, read only).

| File | What it holds |
|---|---|
| `src/data-grid.tsx` | The grid: scrolling, the heads, the cells, selection by pointer and keys, editing, widths |
| `src/selection.ts` | What is selected, and how keys and clicks change it |
| `src/widths.ts` | How columns that were given no width share the room |
| `src/text-width.ts` | How wide a text is when drawn: what a column is fitted to |
