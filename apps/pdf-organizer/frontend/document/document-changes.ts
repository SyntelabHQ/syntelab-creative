/**
 * Changes to what a document has beside its pages: bookmarks renamed or
 * removed, attached files taken out. They are made in the file when the
 * document is saved (see `save_document` and `save_pages`).
 */

/** A bookmark of the file, found by its place at every level (from 0), and what happens to it. */
export interface BookmarkEdit {
  readonly path: readonly number[];
  readonly title?: string;
  readonly remove?: boolean;
}

export interface DocumentChanges {
  readonly bookmarks: readonly BookmarkEdit[];
  /** Names of attached files to take out. */
  readonly detach: readonly string[];
}

export const NO_CHANGES: DocumentChanges = { bookmarks: [], detach: [] };

export const hasChanges = (changes: DocumentChanges) => changes.bookmarks.length > 0 || changes.detach.length > 0;

const samePath = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((place, level) => place === b[level]);

/** What was decided for the bookmark at `path`, if anything. */
export function bookmarkEdit(changes: DocumentChanges, path: readonly number[]): BookmarkEdit | undefined {
  return changes.bookmarks.find((edit) => samePath(edit.path, path));
}

/** The changes with the bookmark at `path` given a new title, or taken out; `null` forgets what was decided for it. */
export function withBookmarkEdit(changes: DocumentChanges, path: readonly number[], edit: { title?: string; remove?: boolean } | null): DocumentChanges {
  const known = bookmarkEdit(changes, path);
  const others = changes.bookmarks.filter((other) => other !== known);
  if (edit === null) return { ...changes, bookmarks: others };
  return { ...changes, bookmarks: [...others, { ...known, ...edit, path }] };
}

/** The changes with the attached file of this name taken out (`detached`), or kept after all. */
export function withDetached(changes: DocumentChanges, name: string, detached: boolean): DocumentChanges {
  const others = changes.detach.filter((other) => other !== name);
  return { ...changes, detach: detached ? [...others, name] : others };
}
