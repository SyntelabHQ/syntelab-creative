# 0005 — Modules and add-ons on demand

**Context:** The app must stay light.

**Decision:** Modules are chosen at install and can be installed/uninstalled, enabled/disabled any time. Heavy dependencies (e.g. OCR) are add-ons downloaded only when enabled.

**Consequences:** We need a module catalog on syntelab.com, signed and verified packages, and a module manager in the shell.

**Terminology (2026-10-09):** what this decision calls a "module" is now an **app** (see [0012](0012-apps-not-modules.md)); "module" now means a part of the code (see [0013](0013-modular-code.md)).
