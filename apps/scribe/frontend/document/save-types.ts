/** The kinds of files "Save as" offers, each with its endings (the first is the one written when none is typed). */
const SAVE_TYPES = [
  { id: 'text', extensions: ['txt'] },
  { id: 'markdown', extensions: ['md', 'markdown'] },
  { id: 'csv', extensions: ['csv', 'tsv'] },
  { id: 'json', extensions: ['json'] },
  { id: 'html', extensions: ['html', 'htm'] },
  { id: 'subtitles', extensions: ['srt', 'sub', 'vtt'] },
  { id: 'word', extensions: ['docx'] },
  { id: 'pdf', extensions: ['pdf'] },
  { id: 'all', extensions: ['*'] },
] as const;

/** A document a text is written as, apart from its own file: Word or PDF. */
export type DocumentFormat = 'docx' | 'pdf';

/**
 * The types of the "Save as" window, the one of the file's own ending first
 * (the window starts with it); a file whose ending is none of them starts
 * with "All files", so its ending is kept. `nameOf` gives a type's name.
 */
export function saveTypes(ending: string, nameOf: (id: string) => string): { name: string; extensions: string[] }[] {
  const own = SAVE_TYPES.find((type) => (type.extensions as readonly string[]).includes(ending)) ?? SAVE_TYPES[SAVE_TYPES.length - 1];
  return [own, ...SAVE_TYPES.filter((type) => type !== own)].map((type) => ({ name: nameOf(type.id), extensions: [...type.extensions] }));
}

/** The document a path asks for by its ending; null for a text file. */
export function documentFormat(path: string): DocumentFormat | null {
  const ending = /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase();
  return ending === 'docx' || ending === 'pdf' ? ending : null;
}
