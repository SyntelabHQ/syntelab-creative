# locales — global translations

Texts shared by the whole program. App texts live in each app's own
`locales/` folder. Rules: `docs/localization/README.md`.

```
locales/
  languages.json      the 62 languages in the order they are offered (as on
                      syntelab.com), each with its own name and its English
                      name; the source language; the RTL list
  en/                 source (English) — the only folder edited by hand
    common.json       shared terms every app may use (Open, Save, Cancel, Page...)
    shell.json        start screen, settings, menus, app manager, first run
  ro/, de/, ar/ ...   translations, same file names as en/
```

Availability follows the folders present here. Current translation status is in
`docs/localization/PROGRESS.md`; a folder alone does not imply completeness.

Namespaces: `common.*` and `shell.*`. Apps may read `common.*`, but
never another app's keys.
