# Adding a new app

1. Create `apps/<app-id>/`: lowercase, hyphens, no spaces (e.g. `apps/units/`).
   The display name ("Units") goes only in `app.json` and translations.
2. Copy the structure of `apps/pdf-organizer/`:
   ```
   apps/<app-id>/
     README.md      what the app is
     PLAN.md        what it does and in what order
     app.json    manifest (id without spaces, e.g. "units")
     backend/       Rust: implements SyntelabApp
     frontend/      React: views + commands
     locales/       app translations (en.json is the source)
     assets/        icon and color
     addons/        heavy optional parts, on demand (if any)
     tests/         app tests
   ```
3. In `app.json`, list the app's tools under `tools`: for each menu of its own,
   `menuKey`, `icon` and an optional `hintKey` (what the tool is for). The list
   on the side shows them in that order.
4. List the app's commands in `frontend/commands.ts` (name, menu, group, icon).
   The shell shows them in the menus, the tools and the search; nothing about
   menus or bars is written in the app.
5. Add the app to the catalog (`remote/`) as `coming-soon` until ready.
6. The shell does not change.

If the new app needs code that already exists in another app, move
that code to `crates/` or `packages/` first. Same for shared terms: move
them to `common.*`.
