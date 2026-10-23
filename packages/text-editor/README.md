# text-editor

The editor the apps write and show text in (Scribe's texts, what goes into and comes out of a tool of Dev). Built on CodeMirror: it holds long texts without slowing down, writes each line in the direction of its own letters, and undoes step by step.

## Modules

| File | Job |
|---|---|
| `src/text-editor.tsx` | `TextEditor`: the editor, and the handle the rest of an app works it with |
| `src/editor-theme.ts` | How it looks, in the colours of the program's theme |
| `src/editor-phrases.ts` | The words of its own strips (find and replace), from `common.editor.*` in `locales/` |
| `src/syntax.ts` | The colours of a text that is code (JSON, YAML, XML, HTML and SQL, each read by its `@codemirror/lang-…` package) |
| `src/match-marks.ts` | Places and lines marked in the text by a tool |
