import type { AppHost } from '@syntelab/shell-api';
import { openFile } from '../api/dev-api';
import type { OpenedFile } from '../api/dev-api';

/**
 * The result of a file, or of a text that comes out as bytes, is written to a
 * file of the program's own (`newResultFile`) and shown from there: whole when
 * it is text that can be shown, its start when it is a very large text, and as
 * a preview of its bytes otherwise. Save copies that file to where the user
 * chooses.
 */

/** A text longer than this (in characters) is not run again at every key: the Run button does it. */
export const TEXT_RUN_BY_ITSELF_UP_TO = 1_000_000;

/** A file worked on from disk up to this size is run as it is opened and whenever the options change; a larger one waits for Run. */
export const FILE_RUN_BY_ITSELF_UP_TO = 128 * 1024 * 1024;

/** The most bytes copied as Base64, or as a picture: beyond it the clipboard is not the place for them. */
export const COPIED_MOST = 32 * 1024 * 1024;

/** How a result written to a file is shown: whole as a text, only its start (it is too large), or as bytes. `size` is in bytes. */
export type ShownResult = { readonly as: 'text' | 'start'; readonly text: string; readonly size: number } | { readonly as: 'bytes'; readonly size: number };

/** How a result is shown, from what reading its file gave. */
export function shownOf(opened: OpenedFile): ShownResult {
  if (opened.binary === true) return { as: 'bytes', size: opened.size };
  if (opened.large === true) return { as: 'start', text: opened.head ?? '', size: opened.size };
  return { as: 'text', text: opened.text ?? '', size: opened.size };
}

/** Reads a result of the program's own, to be shown. A text that is not UTF-8 is shown as bytes: it is saved as it is. */
export const showResult = (host: Pick<AppHost, 'invoke'>, path: string) => openFile(host, path, true).then(shownOf);

/** Whether a file worked on from disk is run by itself, or waits for Run. */
export const fileRunsByItself = (size: number) => size <= FILE_RUN_BY_ITSELF_UP_TO;

/** First bytes written as hexadecimal digits (`89 50 4E 47 …`), in lines of 16 bytes, each led by where it starts. */
export function hexLines(start: string): string[] {
  const bytes = start.split(' ').filter((byte) => byte !== '');
  const lines: string[] = [];
  for (let at = 0; at < bytes.length; at += 16) lines.push(`${at.toString(16).toUpperCase().padStart(8, '0')}  ${bytes.slice(at, at + 16).join(' ')}`);
  return lines;
}
