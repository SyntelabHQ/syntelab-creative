# shell/src — shell interface (React)

Entry: `main.tsx` → `shell.tsx` (applies theme and language, then shows the
first-run screen or the window). Each folder is one module; other modules use
it only through its `index.ts`.

| Module | Job |
|---|---|
| `window/` | The main window: the bar on top, the active tab |
| `app-switcher/` | The Syntelab logo, first on the bar on top: the apps, the search, the donation banner |
| `side-actions/` | What is new, feedback and support: small icons at the bottom of the list of tools |
| `tabs/` | Open tabs (shell and apps side by side), the tab strip, and the question before unsaved changes are lost (`close-guard.tsx`) |
| `start/` | Start screen: apps (as cards, icons with names or icons, in the user's order), donation banner |
| `changelog/` | Changelog window: reads `remote/creative/check/changelog/<language>.json` (the copies bundled with the program) |
| `links/` | Links to syntelab.com pages (support, feedback), in the program's language |
| `settings/` | General settings (theme, language) |
| `first-run/` | First run: wordmark, theme, language |
| `preferences/` | Saved choices (theme, language, first run done) and their pickers |
| `commands/` | The command registry instance, shell commands, menu and search |
| `apps/` | App list from `apps/<app-id>/app.json`, app icons and names |
| `app-host/` | Shows an app's interface in its tabs and gives it the shell's services (`AppHost`), including a place for its own small data (`app-data.ts`) |
| `layout/` | The frame around an app, fed by the command registry: the top bar (menus, search, main commands), the list of the app's tools (`tools/`, in the order of `tools` in `app.json`) and the bar of the open tool, which gives way as the window narrows (`tools/fit-groups.ts`) |
| `immersive/` | Lets an app hide the shell's bars (read mode) or take the whole screen; Escape brings them back |
| `i18n/` | Finds and loads `locales/` and `apps/<app-id>/locales/`, sets `lang`/`dir` |
| `theme/` | Applies light/dark/automatic |
| `brand/` | Wordmark and the Sansation brand font |
| `platform/` | The only place that talks to Tauri (detect it, open web links, file dialog, app commands and resources) |
| `state/` | Tiny store used by the modules above |

Planned next: recent files on the start screen, Settings → Apps.

Rules: no visible text in code (translation keys only), logical CSS properties
only (`margin-inline-start`, never `margin-left`), so RTL works everywhere.
