import { fileName } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import type { FileForm } from './text-file';

/** How long what was handed over is kept after it is first asked for: a tab asks more than once while it starts. */
const KEPT_FOR = 10_000;

/** The line each file's tab is asked to show, by the file's path: read by the tab when it opens or comes to the front. */
const askedLines = new Map<string, number>();

/** Opens a text file in its own tab (or brings its tab to the front), at a line (from 1) when one is given. */
export function openTextInTab(host: Pick<AppHost, 'openTab'>, path: string, line?: number): void {
  if (line !== undefined) askedLines.set(path, line);
  host.openTab({ key: path, title: fileName(path), params: { path } });
}

/** Opens the tab that shows a file too large for the editor, a page at a time. */
export function openLargeFileTab(host: Pick<AppHost, 'openTab'>, path: string): void {
  host.openTab({ key: `large:${path}`, title: fileName(path), params: { large: path } });
}

/** How long a line asked for is kept after the tab first reads it: a tab reads it more than once while it starts. */
const LINE_KEPT_FOR = 1500;

/** The line a file's tab was asked to show; undefined when none was. It is forgotten a moment after the tab first asks. */
export function takeAskedLine(path: string): number | undefined {
  const line = askedLines.get(path);
  // Forgotten only if no other line was asked for in the meantime.
  if (line !== undefined) setTimeout(() => askedLines.get(path) === line && askedLines.delete(path), LINE_KEPT_FOR);
  return line;
}

/** An editor as it was in another tab (see `TextEditorHandle.snapshot`), with how its text is kept in its file. */
export interface HandedEditor {
  readonly state: unknown;
  readonly form: FileForm;
}

/** Editors handed to the tabs of files that were just saved under a new name, by the file's path. Kept in memory only. */
const handedEditors = new Map<string, HandedEditor>();

/**
 * Opens the tab of a file that was just written from another tab ("Save as"), which goes on from where that
 * one was: the same text, cursor and history of changes, so Undo still works after the file changed its name.
 */
export function openSavedTextInTab(host: Pick<AppHost, 'openTab'>, path: string, editor: HandedEditor): void {
  handedEditors.set(path, editor);
  openTextInTab(host, path);
}

/** The editor handed to a file's tab; undefined when there was none. It is forgotten a moment after the tab first asks. */
export function takeHandedEditor(path: string): HandedEditor | undefined {
  const handed = handedEditors.get(path);
  if (handed !== undefined) setTimeout(() => handedEditors.delete(path), KEPT_FOR);
  return handed;
}

/** Opens the tab that finds and replaces in a folder (one is enough: asking again brings it to the front). */
export function openFolderSearchTab(host: Pick<AppHost, 'openTab'>, title: string): void {
  host.openTab({ key: 'folder-search', title, params: { folderSearch: '1' } });
}

let untitledCount = 0;
/** What a new text starts with, when it starts with something. */
export interface Handover {
  readonly text: string;
  /** The name it is offered to be saved under (a file dropped on the window keeps its own). */
  readonly name?: string;
  /** How it is to be saved: the encoding and the line endings it came with. */
  readonly form?: FileForm;
}

/** Texts handed to tabs that are about to open, by the tab's key. Kept in memory only: they can be long. */
const handedOver = new Map<string, Handover>();

/**
 * Opens a tab with a new text that has no file yet. `title` is its name with
 * `{number}` where the number goes ("Untitled 2"); `text` is what it starts
 * with (the result of a tool, a generated text, a file dropped on the
 * window), and `more` what else is known of it.
 */
export function openNewTextTab(host: Pick<AppHost, 'openTab'>, title: string, text = '', more: Omit<Handover, 'text'> = {}): void {
  untitledCount += 1;
  const key = `untitled:${Date.now()}:${untitledCount}`;
  if (text !== '' || more.name !== undefined) handedOver.set(key, { text, ...more });
  host.openTab({ key, title: title.replace('{number}', String(untitledCount)), params: { untitled: key } });
}

/** What was handed to a new tab; an empty text when there was nothing. It is forgotten a moment after the tab first asks. */
export function takeHandover(tabKey: string): Handover {
  const handed = handedOver.get(tabKey);
  if (handed === undefined) return { text: '' };
  setTimeout(() => handedOver.delete(tabKey), KEPT_FOR);
  return handed;
}
