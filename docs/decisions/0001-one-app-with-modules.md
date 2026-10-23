# 0001 — One app with modules

**Context:** Syntelab Creative will have many tools. Separate programs would mean separate installs, settings and updates.

**Decision:** One app (shell) with modules, like Affinity. Shared start screen, module bar, tabs from different modules open at the same time.

**Consequences:** A stable contract between shell and modules. The shell must stay small.

**Terminology (2026-10-09):** what this decision calls a "module" is now an **app** (see [0012](0012-apps-not-modules.md)); "module" now means a part of the code (see [0013](0013-modular-code.md)).
