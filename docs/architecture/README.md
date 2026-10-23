# Syntelab Creative architecture

## Core idea
A small **shell** (the base of the program) + **apps** added on demand. The shell
knows nothing about PDFs or conversions. It only loads apps that follow
a shared **contract**.

```
┌──────────────────── Syntelab Creative (shell, Tauri) ────────────────────┐
│ Start screen · App bar · Tabs · Settings · Themes · i18n · Updates     │
│ App manager · Command registry · Jobs (progress/cancel)                │
├────────────────────┬────────────────────┬────────────────────────────────┤
│  PDF Organizer     │  Convert           │  ... (coming soon)             │
│  frontend (React)  │  frontend (React)  │                                │
│  backend (Rust)    │  backend (Rust)    │                                │
│  locales/          │  locales/          │                                │
│  add-on: OCR       │                    │                                │
├────────────────────┴────────────────────┴────────────────────────────────┤
│ Shared code: crates/ (Rust) · packages/ (TypeScript/React) · locales/     │
└──────────────────────────────────────────────────────────────────────────┘
```

## Layers
1. **Shell** — `shell/`.
2. **Shared code** — `crates/` (Rust), `packages/` (TypeScript), `locales/` (global translations).
3. **Apps** — one folder each in `apps/` (`apps/pdf-organizer/`, `apps/convert/`).
   Each has `backend/`, `frontend/`, `app.json`, `locales/`, `assets/`,
   `tests/`, `PLAN.md`.
4. **Add-ons** — heavy optional parts of an app, in `apps/<app-id>/addons/`.

## Rules
- An app talks to the shell **only through the contract**
  (`crates/syntelab-app-api` and `packages/shell-api`).
- **An app never uses another app directly.** Anything two apps
  need moves to `crates/` or `packages/` (e.g. `crates/syntelab-office-bridge`).
- Every command is registered in the **command registry**, so it appears in
  the ribbon, menu, side panel and search automatically.
- No visible text in code: only translation keys (`docs/localization/`).
- Long operations run as **jobs** with progress and cancel.
- Nothing leaves the program without the user's consent.
- Code, comments and docs are in English.

## Code modules
"App" is what the user installs. "Module" is a part of the code
([decision 0013](../decisions/0013-modular-code.md)).

- Every major part is its own module: in the shell (window, tabs, settings,
  i18n, updates, app manager...), in shared code, and inside each app.
- A module can contain submodules when it grows
  (e.g. `apps/pdf-organizer/backend/src/render/` → `pages`, `thumbnails`, `search`).
- Each module has one job, a small public interface, private internals,
  its own tests and a short README.
- Modules depend on interfaces, never on another module's internals.
  Replacing a module means re-implementing its interface; nothing else changes.

```
apps/pdf-organizer/backend/src/
  engine/      MuPDF binding (only module that touches MuPDF): open, assemble,
               change pages, forms, marks, sign, time stamps, OCR, export
  render/      pages + thumbnails
  lib.rs       the app's commands, called by the shell
```

## Folder names and ids
All folder and file names are lowercase, words separated by hyphens
(except conventional files like `README.md`, `PLAN.md`, `LICENSE`).
An app folder is named after the app **id**: `apps/pdf-organizer/`,
`apps/convert/`. The display name ("PDF Organizer") lives only in
`app.json` and translations. Rust/npm packages use the id too
(`pdf-organizer-backend`).

Details: [app-contract.md](app-contract.md),
[new-app.md](new-app.md), [distribution.md](distribution.md),
[performance.md](performance.md), [../localization/README.md](../localization/README.md).
