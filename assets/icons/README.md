# Interface icons

Icons for buttons and menus shared by the shell and every app (Settings,
Start, search, close…). Each app's own icon lives in
`apps/<app-id>/assets/icon.svg`; the program logo is `assets/brand/icon.svg`.

Source: **Font Awesome Free**, https://fontawesome.com/search?ic=free-collection
(license: https://fontawesome.com/license/free, see
`docs/decisions/0014-font-awesome-free-icons.md`).

## Adding an icon

1. Find a **Free** icon on fontawesome.com and download its SVG.
2. Put the file here, keeping Font Awesome's name (lowercase, hyphens):
   `gear.svg`, `magnifying-glass.svg`.
3. Use it in code by that name: `<Icon name="gear" />` (from `@syntelab/ui-kit`).

Rules:
- Keep the comment inside each file (`Font Awesome Free … License …`). It is
  the attribution the license asks for.
- One color only. The program paints the icon in the current text color, so
  colors inside the file are ignored.
- Only Free icons. Pro icons need a paid license and cannot be in an open
  source repository.

## In use now

Icons of menu commands are named in the command definitions
(`shell/src/commands/shell-commands.ts`, `apps/<app-id>/frontend/commands.ts`);
the table lists only the ones used elsewhere.

| File | Where |
|---|---|
| `house.svg` | Start, in the app bar |
| `gear.svg` | Settings, in the app bar |
| `magnifying-glass.svg` | Command search |
| `moon.svg` | Light/dark theme switch |
| `bars.svg` | Command menu |
| `xmark.svg` | Close a tab |
| `support.svg` | Support: donation banner and app bar |
| `circle-arrow-up.svg` | A newer version is available, in the app bar |
| `feedback.svg` | Report a problem, in the app bar |
| `changelog.svg` | Changelog, in the app bar |
| `folder-open.svg` | Open a file (PDF Organizer) |
| `magnifying-glass-plus.svg`, `magnifying-glass-minus.svg` | Zoom in and out (PDF Organizer) |
| `triangle-exclamation.svg` | Error messages |
| `chevron-up.svg`, `chevron-down.svg` | Previous and next page (PDF Organizer) |
| `sliders.svg` | View options (PDF Organizer) |
| `check.svg` | Chosen item in a menu |
| `rotate-right.svg` | Rotate view (PDF Organizer) |
