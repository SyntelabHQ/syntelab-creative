# Scribe: backlog

Open work for Scribe. The stages of `PLAN.md` are built.

## Features

- Spell checking: needs dictionaries for each language with suitable licences.
- Text out of PDF and office documents: PDF Organizer's engine can do it; how one app uses another's
  engine is a suite-level decision still to make.
- Editing a large file (over 64 MB) without loading it whole, and recipes that work on a file part by
  part where the tool allows it (sorting never can).
- Romanian diacritics: a full word list with a suitable licence (today only common words, in
  `backend/src/language/romanian/words.txt`), and choosing between readings by word frequency.
- Recently opened texts on the program's Start page, beside the apps (needs a shared place in the shell).
- Add-ons installed with one click from the project's releases.

## Cleanup

- Two tools panels exist side by side, switched by View → "Tools one at a time": the classic one
  (`frontend/tools/tools-panel.tsx`, `tool-field.tsx`, `tool-fields.tsx`) and the one-at-a-time one
  (`frontend/tools/pages/`). Keep one and delete the other with the switch;
  `tools/pages/use-tool-runner.ts` repeats logic of `tools-panel.tsx` until then.

## Ideas, not decided

- Typing, reading, speaking and handwriting speed tests (the web version has them).
