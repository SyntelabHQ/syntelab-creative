# Syntelab Creative

**One program, many apps.** A free, open source suite for everyday work with
files and text, on your own computer. No account, no ads, no telemetry.

**[Download for Windows](https://github.com/SyntelabHQ/syntelab-creative/releases/latest/download/syntelab-creative-setup.exe)**
· Linux: [.deb](https://github.com/SyntelabHQ/syntelab-creative/releases/latest/download/syntelab-creative.deb),
[.rpm](https://github.com/SyntelabHQ/syntelab-creative/releases/latest/download/syntelab-creative.rpm),
[AppImage](https://github.com/SyntelabHQ/syntelab-creative/releases/latest/download/syntelab-creative.AppImage)
· [macOS (.dmg)](https://github.com/SyntelabHQ/syntelab-creative/releases/latest/download/syntelab-creative.dmg)
· [Website](https://syntelab.com/creative) · [All releases](https://github.com/SyntelabHQ/syntelab-creative/releases)

| App | What it does |
|---|---|
| **PDF Organizer** | View, organize, combine, edit and sign PDFs; batch processing, OCR, forms, compare |
| **Scribe** | A text editor with tools: clean, sort, compare and transform text |
| **Dev** | Tools for developers: formats, encodings, hashes, network checks and more |
| **Units** | Unit converters: length, temperature, currency and many more |

- **Private by design.** Your files stay on your computer. The program only
  reads two small files from syntelab.com (is there a new version, what is
  new), and only if you allow it; nothing about you is sent.
- **Not limited.** No page counts, no file sizes, no paid tiers: each app can
  do as much as your computer can.
- **62 languages**, light and dark themes, right-click entries in Windows
  Explorer.
- **Windows** 10 and 11. **Linux and macOS** builds are made from the same
  open source code, but they have not been tested yet. If something does not
  work, please open an issue: we will fix and update them based on your
  feedback. The macOS build is not signed by Apple; the first time, open it
  with right-click → Open.

## Feedback and contributing

Everyone can help shape Syntelab Creative: with ideas, opinions and advice,
by reporting bugs, and with changes to the code. Your feedback decides what
comes next: bugs to fix, things to improve, new features and new apps.

- **Ideas, opinions, bugs:** open an
  [issue](https://github.com/SyntelabHQ/syntelab-creative/issues), or write to
  us from the program (the Feedback button opens the feedback page).
- **Code and translations:** fork the repository and open a pull request.
  For a larger change, open an issue first so we can agree on it. How the
  project is built is described below and in [docs/architecture](docs/architecture/README.md); keep to
  its rules (English source, one folder per app), run the tests, and your
  contribution is published under the same license (AGPL-3.0).

## Made with AI

Syntelab Creative is built by Syntelab with the help of AI: much of the code,
the tests and the translations were written with an AI assistant, and every
change is reviewed and tested by us.

## Building it yourself

Needs Node.js 22+, Rust (stable, through [rustup](https://rustup.rs)), the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) (on Windows: the
MSVC C++ build tools and WebView2) and LLVM/Clang (https://releases.llvm.org),
with the environment variable `LIBCLANG_PATH` pointing at its `bin` folder.
The first build compiles MuPDF and takes several minutes.

| Command | What it does |
|---|---|
| `npm install` | Installs the TypeScript dependencies (once) |
| `npm run dev` | Starts the program in a Tauri window, with live reload |
| `npm run dev:web` | Starts only the interface, in a browser at `http://localhost:1420` (no Rust needed) |
| `npm run typecheck` | Type-checks all TypeScript |
| `npm test` | Runs the TypeScript tests |
| `cargo test` | Runs the Rust tests |
| `npm run build` | Builds the program |
| `node tools/generate-test-pdfs.mjs` | Writes the test PDFs to `tests/fixtures/generated/` |

- What we build and why: [CONCEPT.md](CONCEPT.md)
- Order of work and open questions: [PLAN.md](PLAN.md)
- How the code is split: [docs/architecture/README.md](docs/architecture/README.md)
- Localization (62 languages): [docs/localization/README.md](docs/localization/README.md)
- Decisions: [docs/decisions/README.md](docs/decisions/README.md)

## Language rule

All code, comments, documentation and source strings are written in
**English**. Translations live only in `locales/` folders
(see [docs/decisions/0009-english-only-source.md](docs/decisions/0009-english-only-source.md)).

## Folder rule

- **One folder per app**, inside `apps/`: `apps/pdf-organizer/`,
  `apps/convert/`, ... The folder name is the app id. Everything that belongs only to an app lives in its folder
  (code, tests, translations, icon, app plan).
- **Every folder outside `apps/` is the central structure**, shared by the whole program.
- An app **never uses another app directly**. Anything two apps
  need moves into the central structure (`crates/` or `packages/`).

## Folder map

| Folder | Contents |
|---|---|
| `apps/<app-id>/` | One folder per app (`pdf-organizer`, `scribe`, `dev`, `units`, and the ones still to come): code, tests, translations, icon, plan |
| `shell/` | The shell (Tauri): window, start screen, tabs, settings |
| `crates/` | Shared Rust code (app contract, jobs, network, platform) |
| `packages/` | Shared TypeScript/React code (UI kit, commands, i18n) |
| `locales/` | Global translations: shell + common terms (62 languages, source: English) |
| `integrations/` | OS integration (Windows Explorer right-click, Linux desktop) |
| `installers/` | Windows, Linux, macOS installers |
| `remote/` | The files of syntelab.com the program reads (update, changelog) |
| `assets/` | Syntelab Creative logo, colors, shared icons, fonts |
| `docs/` | Architecture, localization, decisions, legal, UI |
| `tests/` | Whole-app tests and shared test files |
| `third-party/` | Patched copies of dependencies, only while a needed fix is unreleased |
| `tools/` | Helper scripts (build, translation checks) |

## License and attribution

Copyright © 2026 Syntelab.

Syntelab Creative is free software under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). You may use,
study, change and share it under that license.

Under section 7(b) of the license, anyone who shares this program or a work
based on it must keep this attribution, in the program (for example in its
About window) and in its documentation:

> Based on Syntelab Creative by Syntelab - https://syntelab.com

The exact terms are in [NOTICE](NOTICE). "Syntelab" and "Syntelab Creative"
are names of Syntelab; a changed version must use a name of its own (see
`docs/legal/`). The parts it is built from, and their licenses, are listed in
[THIRD-PARTY.md](THIRD-PARTY.md).
