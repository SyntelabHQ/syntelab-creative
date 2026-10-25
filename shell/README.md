# shell — the base of the program

Tauri. Knows nothing about PDFs or conversions. It only knows how to load
apps that follow the contract (`docs/architecture/app-contract.md`).

Contains: a window per app, the app switcher, app bar, tabs, settings, themes,
languages, updates, app manager, problem reporting, donations.

| Folder | Contents |
|---|---|
| `src/` | Shell interface (React) |
| `src-tauri/` | Shell Rust side (Tauri) |
