import { EditorView } from '@codemirror/view';

/**
 * How the editor looks, in the colours of the program's theme (they are CSS
 * variables, so the editor follows light, dark and the gray themes by
 * itself). The size and the family of the letters come from the element
 * around it (`text-editor.module.css`).
 */
export const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--sc-text)', backgroundColor: 'var(--sc-surface)', fontSize: 'inherit' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--sc-text)', padding: '12px 0' },
  '.cm-line': { padding: '0 16px' },
  '.cm-placeholder': { color: 'var(--sc-muted)', fontFamily: 'var(--sc-font, inherit)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--sc-text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'color-mix(in srgb, var(--sc-accent) 32%, transparent)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--sc-surface-2) 55%, transparent)' },
  '.cm-gutters': { backgroundColor: 'var(--sc-bg)', color: 'var(--sc-muted)', border: 'none', borderInlineEnd: '1px solid var(--sc-border)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--sc-surface-2)', color: 'var(--sc-text)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '40px' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--sc-accent) 18%, transparent)' },
  // What a tool would change, before it is applied.
  '.cm-toolMatch': { backgroundColor: 'color-mix(in srgb, var(--sc-highlight) 38%, transparent)', borderRadius: 'var(--sc-radius-xs)' },
  '.cm-toolChangedLine': { backgroundColor: 'color-mix(in srgb, var(--sc-highlight) 16%, transparent)' },
  '.cm-toolRemovedLine': { backgroundColor: 'color-mix(in srgb, var(--sc-danger) 14%, transparent)', textDecoration: 'line-through', textDecorationColor: 'color-mix(in srgb, var(--sc-danger) 55%, transparent)' },
  // The result of a tool: the lines that differ from the text, and where in the line.
  '.cm-resultChanged': { backgroundColor: 'color-mix(in srgb, var(--sc-highlight) 16%, transparent)' },
  '.cm-resultMoved': { backgroundColor: 'color-mix(in srgb, var(--sc-accent) 10%, transparent)' },
  '.cm-resultAdded': { backgroundColor: 'color-mix(in srgb, var(--sc-success) 16%, transparent)' },
  '.cm-resultPiece': { backgroundColor: 'color-mix(in srgb, var(--sc-highlight) 50%, transparent)', borderRadius: 'var(--sc-radius-xs)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--sc-highlight) 45%, transparent)', borderRadius: 'var(--sc-radius-xs)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, #f57c00 60%, transparent)' },
  // The strip that finds and replaces: the program's own controls.
  '.cm-panels': { backgroundColor: 'var(--sc-bg)', color: 'var(--sc-text)', fontFamily: 'var(--sc-font, inherit)', fontSize: '14px' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--sc-border)' },
  '.cm-panel.cm-search': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '10px 44px 10px 14px', position: 'relative' },
  '.cm-panel.cm-search br': { flexBasis: '100%', height: '0', content: '""' },
  '.cm-panel.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--sc-muted)' },
  '.cm-textfield': {
    minHeight: '34px',
    padding: '0 10px',
    border: '1px solid var(--sc-border)',
    borderRadius: 'var(--sc-radius-s)',
    backgroundColor: 'var(--sc-surface)',
    color: 'var(--sc-text)',
    fontFamily: 'inherit',
    fontSize: '14px',
  },
  '.cm-textfield:focus': { borderColor: 'var(--sc-accent)', outline: 'none' },
  '.cm-button': {
    minHeight: '34px',
    padding: '0 12px',
    border: '1px solid var(--sc-border)',
    borderRadius: 'var(--sc-radius-s)',
    backgroundImage: 'none',
    backgroundColor: 'var(--sc-surface)',
    color: 'var(--sc-text)',
    fontFamily: 'inherit',
    fontSize: '13px',
    cursor: 'pointer',
  },
  '.cm-button:hover': { backgroundColor: 'var(--sc-surface-2)' },
  '.cm-panel.cm-search [name=close]': { position: 'absolute', top: '8px', insetInlineEnd: '10px', width: '28px', height: '28px', fontSize: '18px', color: 'var(--sc-muted)', cursor: 'pointer' },
});
