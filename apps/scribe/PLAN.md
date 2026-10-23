# Scribe — plan

Scribe is a text editor with tools: the text is in the middle, the tools act
on it from a panel beside it, one after another, each as a step that can be
undone. It is not the website's set of separate pages (scribe.skalda.io exists
to be found; the program exists to do the work). Nothing is copied from the
website's code; where its way of doing something is the best one, the same
way is written here anew.

Aim: no limits but what today's technology can do and what the user's
computer can carry. Everything happens on the computer; nothing goes online.

## How it is made

| Part | Where | With |
|---|---|---|
| The editor | `frontend/editor/` | CodeMirror 6 (MIT) |
| Files: reading, writing, encodings, line endings | `backend/src/files.rs` | `encoding_rs`, `chardetng` |
| Operations on text (lines, case, cleaning, find and replace) | `backend/src/ops/` | `regex` (linear time: no pattern can freeze the program) |
| Words, sentences, sorting by the rules of a language | `backend/src/language/` | `unicode-segmentation`; ICU4X where it adds something |
| Comparing | `crates/syntelab-compare` | `similar` (Myers, patience) |
| Folders | `backend/src/folders.rs` | `ignore`, `walkdir` |

Operations live in Rust, once: the editor, a folder and a recipe all run the
same code. The interface sends the text and what to do with it and gets the
new text back with a short account of what changed.

Every dependency has its licence checked before it goes in; the list is in
`README.md`.

## Stages

1. **The editor and files.** A tab per file; new, open, save, save as; the
   encoding and the line endings are found, shown and can be changed; unsaved
   changes are marked; a status line (place, selection, counts).
2. **Tools on the text.** Lines (sort, duplicates, reverse, shuffle, number,
   trim, empty lines, join, split), case, cleaning (spaces, quotes,
   diacritics), find and replace with regular expressions and a list of
   replacements. On the selection or on everything; one step to undo.
3. **Statistics.** Words, characters, sentences, paragraphs, reading time,
   the words used most; counted by the rules of the text's language.
4. **Compare.** Two texts or two files side by side, with what changed inside
   a line.
5. **Folders.** Find in a folder; replace in a folder, with a look at every
   change before anything is written.
6. **Recipes and many files.** A chain of tools kept under a name, run on the
   text, on files or on a folder.
7. **Generators.** Filler text and random text.
8. **Romanian diacritics.** Taking them off, repairing the wrong forms,
   putting them back on text written without them (sure words at once,
   doubtful ones shown to be confirmed).
9. **Settings, Help, About.** The app's settings, its manual in English and
   Romanian, its page under "About".
10. **Later.** Spelling, text out of PDF and office documents, add-ons
    installed with one click (dictation, reading aloud, translation, a local
    model), files too large to hold whole.
