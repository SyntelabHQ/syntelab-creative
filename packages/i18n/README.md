# i18n

Loads the global translations (`locales/`) and each installed app's translations (`apps/<app-id>/locales/`). Default language: the system's. Fallback to English. ICU MessageFormat for plurals and variables. Numbers and dates formatted per language. See `docs/localization/README.md`.

## Modules

| File | Job |
|---|---|
| `src/languages.ts` | Text direction, fallback chain, matching the system language |
| `src/catalog.ts` | Merges message files by priority |
| `src/translator.ts` | Key lookup + ICU MessageFormat |
| `src/i18n.ts` | `loadI18n`: everything the interface needs for one language |
| `src/react/` | `I18nProvider`, `useI18n`, `useTranslation` |

The package does not know where files are; the shell passes a loader.
Number/date formatting helpers are not written yet.
