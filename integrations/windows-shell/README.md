# Windows Explorer — right-click menu

- Entries come from apps: `contextMenu` in `apps/<app-id>/app.json`, each
  with an `id`, a `labelKey` and the `fileTypes` it shows on. They stand in
  the menu by themselves, with the app's icon (PDF Organizer: "Convert to PDF
  with PDF Organizer", "Combine files in PDF Organizer"), or, with
  `contextMenuGrouped`, open to the side from one entry named after the app
  ("Syntelab Dev" > Checksums, Compare, Hex view). Convert (later): "Convert to…".
- Icons: `icons/apps/<app id>.ico` next to the installed program (made by
  `tools/app-shortcut-icons.py`); the program's own icon when it is missing.
- Labels are translated (app keys), in the language the program is in when
  the entries are added.
- Per-user registration (`HKEY_CURRENT_USER\Software\Classes\
  SystemFileAssociations\<.ext>\shell\SyntelabCreative.<app>.<entry>`, or
  `...\shell\SyntelabCreative.<app>\shell\<app>.<entry>` for a group), no
  administrator rights. Every key written is named `SyntelabCreative` or
  starts with `SyntelabCreative.`: writing the entries, or turning them off,
  first takes out every such key on every kind of file, so what an earlier
  version wrote (1.0.0 gathered all under one `SyntelabCreative`) goes too.

## State (2026-10-10)

Built:

- `crates/syntelab-platform/src/explorer_menu.rs` adds the entries and takes
  them out; its tests use a place of their own in the registry.
- Settings → General → "Windows Explorer": the switch that does it
  (`shell/src/settings/explorer-menu-setting.tsx`, commands in
  `shell/src-tauri/src/explorer_menu.rs`).
- An entry starts the program as `syntelab-creative --app <app id> --action
  <entry id> "<file>"` (`shell/src-tauri/src/launch.rs`). Only one copy of
  the program runs; a second one hands its start over (the window comes to
  the front and the app opens the file there). Explorer starts the
  program once per chosen file: the interface gathers what arrives within a
  moment into one request (`shell/src/launch/`).
- The app is told through its tab: `params.launch` and `params.files`.

Not built:

- Windows 11's short menu (`IExplorerCommand`): it takes entries only from
  packaged programs, so it comes with the Microsoft Store variant (MSIX).
- The installer adding the entries and the association of `.pdf` with the
  program; taking them out on uninstall. Until then, every start of an
  installed (release) program whose entries start another program, or were
  written by an earlier version, writes them again to start itself
  (`useExplorerMenuUpkeep`, `shell/src/settings/explorer-menu-setting.tsx`).
  A development build (`npm run dev`) never adds them (its window would show
  the development server, which is not running when Explorer starts it); it
  can take them out, and the setting says so.
- Adding the entries again when the language of the program changes.
