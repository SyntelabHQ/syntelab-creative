# Scribe

The text app of Syntelab Creative: an editor with its tools beside the text.
id: `scribe`.

Everything that belongs only to Scribe lives in this folder.

| Folder | Contents |
|---|---|
| `PLAN.md` | What the app does and why it is built the way it is |
| `BACKLOG.md` | What is still open |
| `app.json` | App manifest for the shell |
| `backend/` | Rust: files and encodings, the tools, statistics, comparing, folders, recipes, generators, Romanian diacritics, large files read a page at a time |
| `frontend/` | React: the editor (CodeMirror), the panel of tools, recipes and statistics, compare, folder and large-file tabs, settings |
| `help/` | The manual (`en.json` is the source), with the "About Scribe" chapter |
| `locales/` | App translations (`en.json` is the source) |
| `assets/` | App icon |

## How it is put together

- A tool is written once, in Rust (`backend/src/ops/`), as an `Operation`.
  The same operation runs on the text in the editor, on a file, and as a
  step of a recipe. On the React side a tool is only its name, its choices
  and the operation they make (`frontend/tools/tool-definitions.ts`).
- Tools that write a text instead of changing one are generators
  (`backend/src/generate/`); they are never steps of a recipe.
- What depends on the language of a text is in `backend/src/language/`:
  sorting (ICU4X), words and sentences (ICU4X), Romanian diacritics (a word
  list and rules written for Scribe, `language/romanian/`).
- Everything runs on the user's computer. Scribe goes online for one thing
  only, and only when asked: "Text of a web page" brings the page at the
  address the user types (`host.readWebPage`; the connection itself is in
  `crates/syntelab-net`, see decision 0004).

## Tests

```bash
cargo test -p scribe-backend
```

```bash
npx vitest run apps/scribe
```
