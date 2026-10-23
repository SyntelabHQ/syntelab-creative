# 0011 — Modules in `modules/`, lowercase folder names

**Replaces:** [0007](0007-one-folder-per-module.md).

**Context:** Module folders sat at the root with display names (`PDF Organizer/`). Spaces and capitals break the naming pattern of every other folder and make scripts and build tools harder to use. With 10+ modules the root would get crowded.

**Decision:** All modules live in `modules/`, one folder each, named after the module id: `modules/pdf-organizer/`, `modules/convert/`. All folder and file names are lowercase with hyphens, no spaces. Exception: conventional uppercase doc files (`README.md`, `CONCEPT.md`, `PLAN.md`, `LICENSE`). Display names exist only in `module.json` and translations. Everything that belongs to a module stays in its folder; everything outside `modules/` is central.

**Consequences:** Folder name = module id = package prefix. Adding a module means adding one folder in `modules/`.

**Terminology (2026-10-09):** what this decision calls a "module" is now an **app** (see [0012](0012-apps-not-modules.md)); "module" now means a part of the code (see [0013](0013-modular-code.md)).
