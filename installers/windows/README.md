# Windows

- **Installer** (.exe/.msi): app choice, right-click menu, PDF association. Signed through SignPath.
- **Portable** (.zip): no right-click menu or associations; settings and apps next to the program.
- **Microsoft Store** (MSIX): signed by Microsoft, Store updates.
- **winget**: one-command install.

## A shortcut for each app

The installer adds a shortcut to the Start menu for every app that is out, named as the app ("PDF Organizer") and kept
in the folder "Syntelab Creative" (the program's own shortcut, "Syntelab Creative", stays outside it, where Tauri puts it).
It starts the program with `--app <app id>` and the program opens right in that app (see `shell/src-tauri/src/launch.rs`).
Its comment ends with "Part of Syntelab Creative." The names up to 1.0.0 ("Syntelab PDF Organizer", outside the folder)
are taken away on install and on uninstall.
The icons (`shell/src-tauri/icons/apps/*.ico`) and the installer lines (`app-shortcuts.nsh`, an NSIS hook of Tauri)
are made by `tools/app-shortcut-icons.py`: run it again when an app is added or its icon or colour changes.

## PDF files

The program registers itself at start, for the user alone, as an app that opens PDF files (see
`crates/syntelab-platform/src/default_app.rs`); the user makes it the default in Windows Settings. On uninstall the same
hook file takes those keys out again (`DEFAULT_APP` in `tools/app-shortcut-icons.py`).
