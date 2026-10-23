/**
 * The words of the editor's own strips, which CodeMirror writes in English:
 * each is looked up under `common.editor.<name>` in the translations. The
 * names on the left are CodeMirror's own phrases and must stay as they are.
 */
const PHRASES: Readonly<Record<string, string>> = {
  Find: 'find',
  Replace: 'replace',
  next: 'next',
  previous: 'previous',
  all: 'all',
  'match case': 'matchCase',
  regexp: 'regexp',
  'by word': 'byWord',
  replace: 'replaceOne',
  'replace all': 'replaceAll',
  close: 'close',
  'current match': 'currentMatch',
  'on line': 'onLine',
  'replaced $ matches': 'replacedMatches',
  'replaced match on line $': 'replacedOnLine',
};

/** The phrases in the language of the program, for `EditorState.phrases`. */
export function editorPhrases(t: (key: string) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(PHRASES).map(([english, name]) => [english, t(`common.editor.${name}`)]));
}
