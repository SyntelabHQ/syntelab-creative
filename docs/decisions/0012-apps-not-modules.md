# 0012 — "Apps", not "modules"

**Context:** PDF Organizer, Convert and the ones that follow were called "modules". In code, "module" already means a part of the code (Rust `mod`, JavaScript modules), and we want the code itself to be built from modules. One word with two meanings causes confusion.

**Decision:** PDF Organizer, Convert and the others are **apps**. Syntelab Creative is the program (a suite) that holds the apps. In folders and code: `apps/<app-id>/`, `app.json`, `crates/syntelab-app-api` (trait `SyntelabApp`), `crates/syntelab-apps-manager`, Settings → Apps. The base of the program is the **shell**, in `shell/` (was `app/`). The word **module** is kept for parts of the code (see [0013](0013-modular-code.md)).

**Consequences:** Replaces the folder name in [0011](0011-modules-folder-lowercase-names.md) (`modules/` → `apps/`); the rest of 0011 stays. Users see "apps" in the interface and on syntelab.com.
