# 0007 — One folder per module, at the root

**Status:** replaced by [0011](0011-modules-folder-lowercase-names.md).

**Context:** Everything about a module should be in one place, separate from the central structure.

**Decision:** Each module has its own folder at the project root, named with its display name (`modules/pdf-organizer/`, `modules/convert/`). Inside: code, tests, translations, icon, module plan. Everything outside module folders is central. In code, a module is identified by an id without spaces (`pdf-organizer`).

**Consequences:** Easy to find, add or remove a module. With 10+ modules the root gets crowded; then modules can be grouped into a `Modules/` folder (a simple move, the contract does not change).

**Terminology (2026-10-09):** what this decision calls a "module" is now an **app** (see [0012](0012-apps-not-modules.md)); "module" now means a part of the code (see [0013](0013-modular-code.md)).
