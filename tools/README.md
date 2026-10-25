# tools — helper scripts

| Script | Job |
|---|---|
| `generate-icons.mjs` | Rebuilds the program icons in `shell/src-tauri/icons/` from `assets/brand/icon.svg` |
| `fetch-pdfium.mjs` | Puts PDFium (`pdfium.dll`, which draws PDF pages on screen) in `third-party/pdfium/`; runs by itself before `npm run dev` and `npm run build` |
| `generate-test-pdfs.mjs` | Writes the test PDFs (small, 2500 pages, picture-heavy) to `tests/fixtures/generated/` |
| `app-shortcut-icons.py` | The Start menu shortcut of each app: its icon and the installer lines (`installers/windows/README.md`) |
| `build-release.ps1` | Builds the Windows installer signed for updates (`remote/README.md`) |
| `test-and-build.ps1` | Runs every test and builds the Windows installer without update signatures |
| `check-locales.mjs` | Translation checks (keys, placeholders, ICU syntax, plurals, manuals), see below |
| `translate-update.mjs` | Brings every language up to date after the English changed, against `docs/localization/english-snapshot.json` |
| `translate-local.mjs` | Translates the missing texts of one language with a local model (LM Studio) |

## Localization checks

See `docs/localization/README.md`, section 6, for the rules.

- `node tools/check-locales.mjs --language=ro --mark-complete`: validate one entire language, then mark it translated and regenerate the compact report only on success.
- `node tools/check-locales.mjs --language=ro --file=apps/units/locales/ro.json`: check one repaired file without modifying progress.
- `node tools/check-locales.mjs --completed`: read-only build precheck for completed languages.
- `node tools/check-locales.mjs --global`: final strict check of all non-English languages, including Romanian and Arabic.
- `--unchanged`: opt into English-identical warnings. Off by default because many technical names stay unchanged.
- `--partial`: optional diagnostic for unfinished files; cannot be combined with marking completion.

Checks cover JSON duplicates, keys, empty text, ICU syntax and variables, plural categories, manual structure and empty manual strings, and app descriptions. Routine checks never rewrite progress. There are no per-key lists, source fingerprints or batch logs in active tracking.
