# 0010 — Localization: global + per module

**Context:** 62 languages, and modules installed on demand. Shared words should be translated once; module texts should come and go with the module.

**Decision:** Two levels. Global: `locales/<lang>/common.json` (shared terms) and `shell.json` (shell). Per module: `modules/<module-id>/locales/<lang>.json`, namespace `<module-id>.*`. Same JSON + ICU MessageFormat files read by frontend and Rust. Fallback: language → base language → English.

**Consequences:** A module may use only its own keys and `common.*`. Automatic checks for missing keys and placeholders. Details: `docs/localization/README.md`.

**Terminology (2026-10-09):** what this decision calls a "module" is now an **app** (see [0012](0012-apps-not-modules.md)); "module" now means a part of the code (see [0013](0013-modular-code.md)).
