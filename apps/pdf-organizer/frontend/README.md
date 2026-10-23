# PDF Organizer — frontend (React)

Entry: `index.ts` exports the app's `AppFrontend`; the shell finds it there.
The app reaches its Rust side and the system only through the `AppHost` it
is given (`@syntelab/shell-api`).

| Module | Job |
|---|---|
| `pdf-organizer-view.tsx` | One tab: a document, or the invitation to open one |
| `document/` | Opening files (one tab per file), the open document's state, the recent files, and the **page plan**: the pages as the user arranged them (`page-plan.ts`, pure and tested), with undo/redo (`history.ts`) |
| `organize/` | "Organize pages": the page grid with selection and drag and drop, and `use-organizer.ts`, which holds the plan and does insert, extract and save as |
| `viewer/` | View bar (page navigator, zoom), page list, thumbnail list. `view-settings.ts` holds the view options and the fit-to-window zoom; `page-rows.ts` groups pages into rows of one or two; `strip-layout.ts` + `use-strip-window.ts` keep only the visible part in the page |
| `empty/` | What a tab without a document shows: open a file, or pick a recent one |
| `commands.ts`, `use-tab-commands.ts` | The app's commands (open, zoom, page display, rotate, read mode…), registered while a tab is in front; the layouts and the search show them |

The other folders hold one feature each: `batch/`, `binder/`, `compare/`,
`create/`, `crop/`, `export/`, `find/`, `forms/`, `insert/`, `links/`,
`marks/`, `ocr/`, `outline/`, `settings/`, `sign/`.
