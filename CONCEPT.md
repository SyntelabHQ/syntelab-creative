# Syntelab Creative — Concept

Version: 0.3 · Date: October 9, 2026 · First app: **PDF Organizer**

This document says **what** we build and **why**, in plain language.
Technical details are in `docs/architecture/`. Important decisions are
recorded in `docs/decisions/`. The order of work is in `PLAN.md`.

History: this concept started as "Skalda" (v0.1, October 8, 2026). The
Skalda name was dropped because of a trademark conflict
(`docs/decisions/0006-name-syntelab-creative.md`).

---

## 1. The idea

**Syntelab Creative** is a single desktop program (a suite) that brings together several
programs, called **apps**, the way Affinity brings Photo, Designer and
Publisher into one program.

- The first app is **PDF Organizer**: view, organize, edit and sign PDFs.
- The second app is **Convert**: convert files between formats.
- Apps that do not exist yet appear on the start screen as "Coming soon".
- Syntelab Creative is **free, open source and tracks nothing**.
- It stays **light**: you install only the apps you use.

## 2. Apps

| # | App | id | In short |
|---|---|---|---|
| 1 | **PDF Organizer** | `pdf-organizer` | View, organize, edit, fill forms, sign PDFs |
| 2 | **Convert** | `convert` | Convert documents and images between formats, PDF ↔ Word/Excel |
| — | **Dev** | `dev` | Tools for developers (in progress) |
| — | **Scribe** | `scribe` | A text editor with tools (in progress) |
| — | **Units** | `units` | Unit converters (in progress) |
| — | **Wizard**, **Pixel**, **Metadata** | `wizard`, `pixel`, `metadata` | Coming soon |
| — | later | — | Ideas from the first concept: Finance (calculators), Solveo (math), Atom (physics/chemistry) |

Each app has its own plan in its folder (`apps/pdf-organizer/PLAN.md`,
`apps/convert/PLAN.md`). The boundary between PDF Organizer and Convert is in
`docs/decisions/0008-pdf-organizer-convert-boundary.md`.

Each app has its own icon and color: PDF Organizer `#7A1F3D` (Font Awesome
`file-pdf`), Convert `#546E7A` (Font Awesome `box-archive`), Dev `#E91E63`,
Scribe `#7B1FA2`, Wizard `#E65100`, Units `#E53935`, Pixel `#0288D1`, Metadata `#3949AB`. Syntelab brand color: `#007BFF`. Each icon is `apps/<app-id>/assets/icon.svg`. Brand font for the
"SYNTELAB CREATIVE" wordmark: **Sansation**.

## 3. What is central and what belongs to an app

| Central (once, for the whole program) | Per app |
|---|---|
| Window, start screen, app bar, tabs | Its screens and tools |
| General settings, themes, languages (incl. RTL), shortcuts | Its own settings |
| App manager (install, enable, update) | `app.json` (app manifest) |
| Command registry (ribbon / menu / panel / search) | Its commands |
| Jobs: progress, cancel, notifications | Its long operations |
| Network (the only place with internet), updates, changelog | Nothing: an app never goes online by itself |
| Global translations: shell + common terms | Its own translations |
| Problem reporting, donations | — |
| Installers, Explorer right-click registration | Which right-click entries it wants |
| Shared conversion code (Office/LibreOffice) | How it uses that code |

## 4. How the program looks

### 4.1 Start screen
- All apps with their icons and colors. Not installed: "Install" button.
  Not available yet: "Coming soon".
- Recently opened files.
- **Donation banner**, always visible, never blocking:
  "Help us build the entire Syntelab Creative ecosystem. Support us" →
  `syntelab.com/support`, in the program's language (e.g. `syntelab.com/ro/support`).
  The same link is in the menu.
- **News** section (section 9). Can be turned off.

### 4.2 Moving between apps and tabs
- An **icon bar** on the side for quick jumps between apps.
- Browser-like **tabs**. Tabs from different apps can be open at the same
  time (e.g. a PDF and a conversion job).
- In PDF Organizer each open document has its own tab.

### 4.3 Three interface layouts (user's choice)
1. **Classic**: menu bar and toolbar.
2. **Ribbon**: like Word, with a quick collapse button.
3. **Side panel**: tools in a panel on the side, with quick icons; left or right.

Can be changed any time in settings. On **first run** the user picks the
layout (with a preview of each), the theme and the language (with
sensible defaults).

### 4.4 Command search
A search box finds any command or setting ("rotate", "signature",
"dark theme"), whatever the layout.

### 4.5 Easy for beginners, complete for experts
- Simple things are visible right away. Advanced things are available but
  stay out of the way.
- Everything can be customized: which buttons appear, where, shortcuts.
- Themes: **light, dark, automatic** (follows the system).

## 5. Languages (localization)

- **62 languages**, the same as syntelab.com. Source language: **English**.
- am ar be bg bn bs ca cs da de el en es et fa fi fr ga gu ha he hi hr hu id
  it ja jv kn ko lt lv mk ml ms mt my nl no pa pl pt pt-BR ro ru sk sl sq sr
  sv sw ta te th tl tr uk ur vi yo zh-CN zh-TW
- Right-to-left languages (**Arabic, Persian, Hebrew, Urdu**) work correctly
  **from day one**: the interface is mirrored.
- Default: the system language. Can be changed in settings.
- Translations are split in two levels:
  - **Global**: the shell and the common terms every app shares
    (Open, Save, Cancel, Page, File...). One place, translated once.
  - **Per app**: each app ships its own translations in its folder.
    Installing an app brings its texts; removing it removes them.
- Details: `docs/localization/README.md`.

## 6. Apps on demand (to keep the program light)

- At **install** time you choose the apps you want.
- In **Settings → Apps** you can enable, disable, install and uninstall
  at any time.
- Apps are downloaded from **syntelab.com** only when you ask for them.
- Each app brings **its own heavy dependencies**. Example: the OCR engine
  is downloaded only if you turn on OCR.
- The shell (the base of the program) contains only: start screen, tabs, settings,
  languages, themes, updates and the app manager.

## 7. No limits

No limit on pages, files or tabs. To handle huge files:
- Only **visible pages** are rendered.
- **Thumbnails** are made in the background and cached on disk.
- Large merges are **streamed** piece by piece, not loaded into memory.
- Long operations have a **progress bar** and a **Cancel** button.
- If memory gets full, the program **warns** in advance.

## 8. Privacy and updates

- **Zero telemetry.** Syntelab Creative sends nothing about the user.
- The only internet connections: app downloads, update checks and the
  changelog file. All can be turned off.
- **Updates** are installed **only with the user's consent**.

### Reporting problems
- The program **never sends** errors or reports automatically. The user sees
  everything and decides whether to send.
- **"Report a problem"** (Help menu and error messages) opens
  `syntelab.com/feedback` in the browser. The form there has: name, email,
  purpose (including "Bug Report"), message (max. 3000 characters) and an
  optional file (max. 5 MB).
- **Final version:** the program opens a pre-filled link like
  `syntelab.com/feedback?purpose=bug&product=pdf-organizer&version=…&os=…&app=…&msg=…`.
  The website needs a small script (~10 lines) that reads these values and
  fills the form.
- **Until then:** the program copies the report to the clipboard and opens the
  page with the hint "paste with Ctrl+V".
- Rules: no personal data and no file paths in the link; the link stays
  under ~1500 characters. Long logs are saved to a file the user can attach.

## 9. Changelog

Called "News" until 2026-10-09. Opened from the app bar, in a window over
the program; a copy of the file ships with the program, so it also works offline.

- A small static file on syntelab.com (`syntelab.com/creative/check/changelog/<language>.json`).
- No cookies, no tracking: the program only reads the file.
- Used for announcements, e.g. new games with a Steam wishlist link.
- Texts are per language, falling back to English.
- Can be turned off in settings.

## 10. Platforms and installation

All variants are built from **the same code**; only delivery differs.

### Windows 10 and 11 (from the start; minimum is Windows 10)
| Variant | For whom | Notes |
|---|---|---|
| **Installer** (.exe / .msi) | most users | app choice, right-click menu, PDF association |
| **Portable** (.zip) | no install, USB stick | no right-click menu or associations; settings and apps next to the program |
| **Microsoft Store** (MSIX) | one-click install | signed by Microsoft for free, Store updates |
| **winget** | advanced users | one-command install |

### Linux (from the start)
| Variant | For whom |
|---|---|
| **.deb** | Ubuntu, Debian, Mint |
| **.rpm** | Fedora, openSUSE |
| **AppImage** | portable, almost any distro |
| **Flathub** (Flatpak) | the most used Linux "store" |
| **Snap** | Ubuntu (Snap Store) |

### macOS (later)
- .dmg, unsigned at first.

### Signing
- The Windows installer is **signed** through **SignPath** (free for open
  source projects). The Microsoft Store version is signed by Microsoft.

### Apps in every variant
- Everywhere, apps can be added/removed in Settings → Apps.
- In stores (Microsoft Store, Flathub, Snap) apps are still downloaded
  from syntelab.com into the user's folder; the store updates the shell.

## 11. Technology (short)

| Part | Choice | Why |
|---|---|---|
| App framework | **Tauri** | Small and fast apps (not Electron) |
| Backend logic | **Rust** | Fast, memory safe |
| Interface | **TypeScript + React** | Rich interfaces, easy to build |
| PDF engine | **MuPDF** | Fast, complete rendering and editing |

Details: `docs/architecture/README.md`.

## 12. License and trademark

- All of Syntelab Creative is **open source**, license **AGPL-3.0**
  (required by MuPDF).
- The code is published with the **first stable release**.
- The name **"Syntelab Creative"** and the app names are
  protected as **trademarks**. Forks cannot use them.
- The logo and all icons are Font Awesome Free icons (CC BY 4.0). They are
  used under that license and are **not** registered as trademarks
  (`docs/decisions/0014-font-awesome-free-icons.md`).

## 13. Donations

Syntelab Creative sells nothing and has no ads in the program. The project lives
on donations: the start screen banner and the menu link go to
`syntelab.com/support` (in the program's language).
