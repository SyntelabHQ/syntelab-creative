# Localization

Syntelab Creative ships in **62 languages** (`locales/languages.json`).
Source language: **English**. Right-to-left: ar, fa, he, ur.

`languages.json` lists the languages in the order they are offered (the same
as on syntelab.com), each with its own name (`native`) and its English name.
The language list in the program shows all of them; a language can be chosen
once `locales/<lang>/` exists. Under each language's own name the list shows
its name in the language the program is shown in. That name comes from the
system's language data; a translator can override it with the key
`common.language.<code>` (for example `common.language.el`) in
`locales/<lang>/common.json`.

## 1. Two levels: global and per app

| Level | Where | What | Namespace |
|---|---|---|---|
| **Global — common** | `locales/<lang>/common.json` | Terms every app shares: Open, Save, Cancel, Page, File, plurals of files/pages | `common.*` |
| **Global — shell** | `locales/<lang>/shell.json` | Start screen, settings, menus, app manager, first run, donations, changelog, problem reporting | `shell.*` |
| **Per app** | `apps/<app-id>/locales/<lang>.json` | Everything specific to that app | `<app-id>.*` (e.g. `pdf-organizer.*`) |

Rules:
- An app may use its own keys and `common.*`. Never `shell.*` and never
  another app's keys.
- A term used by two or more apps moves to `common.*`.
- Installing an app brings its translations; uninstalling removes them.
  Global translations ship with the shell.
- An app's `app.json` lists its display name and description per
  language too (shown on the start screen before the app is installed);
  the app catalog on syntelab.com carries the same texts.

## 2. Format

- **JSON**, flat keys, one file per language per level.
- **ICU MessageFormat** for variables and plurals:
  `"{count, plural, one {# page} other {# pages}}"`. Required because many
  of the 62 languages have complex plural rules (ru, pl, ar, cs, sl, ga...).
- The frontend reads them through `packages/i18n`.
- Keys are English, descriptive, grouped: `pdf-organizer.binder.addFiles`.
- Never build sentences by joining pieces in code; word order differs by
  language. One key = one full sentence with placeholders.

## 3. Fallback

Requested language → base language (e.g. `pt-BR` → `pt`) → English.
A missing translation never shows a raw key to the user.

## 4. What else gets translated

| Item | Where it lives |
|---|---|
| Shell and app UI | `locales/`, `apps/<app-id>/locales/` |
| Command names (ribbon, menu, search) | the app's keys; search matches the translated name **and** English |
| Windows Explorer / Linux right-click entries | the app's keys, read by `integrations/` |
| Installer texts | `installers/<platform>/locales/` (installer tools have their own formats) |
| Store listings (Microsoft Store, Flathub, Snap) | `installers/<platform>/store/` |
| Changelog | `changelog/<language>.json` on syntelab.com, one file per language, English fallback |
| Manual (Help) | `help/shell/<lang>.json` for the program, `apps/<app-id>/help/<lang>.json` for each app: chapters of topics, not flat keys (see `shell/src/help/manual.ts`); names of menus and buttons are written as the program shows them in that language; English fallback |
| Website links | language in the path: `syntelab.com/<lang>/support` |

## 5. Right-to-left and scripts

- RTL mirroring from day one: `dir="rtl"`, logical CSS properties
  (`margin-inline-start`), mirrored icons where direction matters (arrows,
  undo/redo), not mirrored where it doesn't (play, checkmarks).
- PDF content is **never** mirrored, only the interface.
- **Fonts:** several languages need scripts that some systems lack
  (am, my, bn, gu, kn, ml, pa, ta, te, si, th...). Use system fonts first;
  bundle Noto fallbacks only for scripts the system is missing, as a
  downloadable font pack, to keep the shell small.
- Numbers, dates and file sizes are formatted per language (`Intl` / ICU).

## 6. Workflow

All 61 target languages are translated (`docs/localization/PROGRESS.md`).
Translated means structurally complete; native-speaker and visual review
remain separate quality work.

### Rules

- English is the source. Correct source defects before translating affected messages.
- Preserve keys, ICU variables, manual IDs and structure. Use glossary.md and existing language glossaries for terminology; create a new glossary only when terminology needs it.
- Translate whole files where practical. Split large files only as needed; do not log batches or duplicate key lists.
- Within a language: common and shell catalogs, app catalogs, app descriptions, manuals.
- progress.json is the sole record: one status per language, with an optional next-file note when interrupted. PROGRESS.md is generated from it.
- Run one strict check at the end of a language. If it fails, fix and recheck affected files; then mark the language complete. Checks do not write progress unless explicitly requested.
- Do not run the full test suite or a build after translation batches. The existing build precheck remains a read-only safeguard for completed languages.
- Identical English text is not an error: product names, symbols and standards often stay unchanged. Request that report only for a specific review.
- Translated means catalogs, descriptions and manuals are present and pass structural validation. It does not claim native-speaker or visual review. Those remain separate quality work.
- When English changes, update the affected messages in completed languages. Structural validation cannot detect a stale translation whose source kept the same key and placeholders.

### Commands

- Finish a language and update its single status: `node tools/check-locales.mjs --language=ro --mark-complete`.
- Recheck a repaired file: `node tools/check-locales.mjs --language=ro --file=apps/units/locales/ro.json`.
- Final audit of every target language, including Romanian and Arabic: `node tools/check-locales.mjs --global`.
- Read-only check of completed languages: `node tools/check-locales.mjs --completed`.
- Optional English-identical text report: add `--unchanged`.

Partial checks remain available for troubleshooting, but are not a required translation step and cannot mark a language complete.
