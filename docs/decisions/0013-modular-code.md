# 0013 — Modular code

**Context:** We want changes to be easy and safe: changing one part must not break the others.

**Decision:** Every major part of the code is its own **module**, and a module may contain **submodules** when it grows. Each module:
- has one job, described in its README;
- exposes a small public interface; everything else stays private;
- talks to other modules only through those interfaces (no reaching into their internals);
- can be tested on its own;
- lives in its own folder (Rust: crate or `mod`; TypeScript: package or folder with an `index.ts`).

**Consequences:** See `docs/architecture/README.md`, "Code modules". Apps follow the same rule inside (e.g. PDF Organizer: `engine`, `render`, `organize`, `merge`, `edit`, `forms`, `sign`, each with submodules as needed).
