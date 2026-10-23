# Syntelab Creative — Plan

Version: 0.3 · Date: October 9, 2026

What we build and why: `CONCEPT.md`. This file is the **order of work**
and the **open questions**. Each app has its own plan in its folder.

## Order of work

1. ✅ Concept and folder structure.
2. **Empty shell**: window, start screen, app bar, tabs, themes,
   settings, command registry.
3. **Localization foundation**: global + per-app translation loading,
   RTL mirroring, fonts for all 62 languages, translation checks
   (`docs/localization/README.md`). Done before any real UI text exists.
4. **App contract** + app manager (local apps first).
5. **PDF Organizer**: steps in `apps/pdf-organizer/PLAN.md`.
6. Windows Explorer integration (right-click).
7. Installers: first installer + portable (Windows), .deb + AppImage (Linux).
8. First stable release with PDF Organizer → open source publication.
9. **Convert**: steps in `apps/convert/PLAN.md`.
10. Remaining install variants (.rpm, Microsoft Store, winget, Flathub, Snap).
11. New apps, one at a time.

## Open questions

- "Syntelab" EU trademark: application filed with the EUIPO on 2026-10-09;
  waiting for registration (`docs/legal/README.md`).
- Exact URLs on syntelab.com for the app catalog and changelog
  (proposed: `syntelab.com/apps/catalog.json`, `syntelab.com/changelog.json`).
- The script on `syntelab.com/feedback` that fills the form from the link.
- Default timestamp authority (TSA) for signatures.
- Translation workflow: who translates, and which tool
  (proposal in `docs/localization/README.md`).
