import { AppInvokeError } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import type { FoundFile } from '../frame/batch';

/** What every tool asks of Dev's Rust side: files, and how far long work has got. */

type Invoker = Pick<AppHost, 'invoke'>;

/** A file as `open` gives it: whole when it is small enough to be shown, else its size and its start. */
export interface OpenedFile {
  readonly name: string;
  /** In bytes. */
  readonly size: number;
  readonly text?: string;
  /** How the bytes of the file were written, when that is not UTF-8: it was read as text all the same. */
  readonly encoding?: string | null;
  /** Too large to be shown whole: the tools read it from where it is on disk. */
  readonly large?: boolean;
  /** The start of a large file, as text. */
  readonly head?: string;
  /** The file is not text: it has no start to show. */
  readonly binary?: boolean;
}

/** Opens a file. With `bytes`, one that is not text is not refused: it stays on disk, to be worked on from there. */
export const openFile = (host: Invoker, path: string, bytes = false) => host.invoke<OpenedFile>('open', { path, bytes });

/** The files under what was chosen: a file is itself, a folder is the files in it (and under it, when `deep`) with one of the endings. */
export const findFiles = (host: Invoker, paths: readonly string[], deep: boolean, endings: readonly string[]) => host.invoke<{ files: FoundFile[] }>('find_files', { paths, deep, endings }).then((found) => found.files);

export const saveText = (host: Invoker, path: string, text: string) => host.invoke<unknown>('save', { path, text });

/** A name for a new result of the program's own: a file of its cache that a tool writes to while its result is only looked at. */
export const newResultFile = (host: Invoker) => host.invoke<{ path: string }>('result_file').then((made) => made.path);

/** Copies a result of the program's own to where the user chose. */
export const keepResult = (host: Invoker, from: string, to: string) => host.invoke<unknown>('result_keep', { from, to });

/** Deletes a result of the program's own that is no longer shown. Nothing is said when that does not work: the folder is emptied when the program starts. */
export const forgetResult = (host: Invoker, path: string) => void host.invoke<unknown>('result_forget', { path }).catch(() => {});

/** What a file is, told from its start. */
export interface Look {
  /** The number it is shown by: a picture or a PDF is the resource `look/<look>`. */
  readonly look: number;
  /** How it can be shown. A picture or a PDF too large to be shown whole is `other`. */
  readonly view: 'picture' | 'pdf' | 'text' | 'other';
  readonly mime: string;
  /** The name of its format (`PNG`, `ZIP`); null for text, and for what is not known. */
  readonly format: string | null;
  /** In bytes. */
  readonly size: number;
  /** Its first bytes, as hexadecimal digits with a space between bytes. */
  readonly start: string;
}

export const lookAt = (host: Invoker, path: string) => host.invoke<Look>('look', { path });

export const closeLook = (host: Invoker, look: number) => void host.invoke<unknown>('look_close', { look }).catch(() => {});

/** The bytes of a file as Base64 (what the hex viewer copies a range with). */
export async function fileAsBase64(host: Invoker, path: string): Promise<string> {
  const held = await host.invoke<{ hex: number; size: number }>('hex_open', { path });
  try {
    return (await host.invoke<{ text: string }>('hex_copy', { hex: held.hex, from: 0, to: held.size, form: 'base64' })).text;
  } finally {
    void host.invoke<unknown>('hex_close', { hex: held.hex }).catch(() => {});
  }
}

export interface Progress {
  readonly running: boolean;
  /** Bytes read, of how many. */
  readonly done: number;
  readonly total: number;
  /** In a run over many files: the one being worked on (from 1), of how many. Both 0 otherwise. */
  readonly file: number;
  readonly files: number;
}

export const workProgress = (host: Invoker) => host.invoke<Progress>('progress');

/** Asks the long work that is running to stop: it fails with the code `stopped`. */
export const stopWork = (host: Invoker) => host.invoke<unknown>('stop');

/** The problems the Rust side names, each with a text of its own under `dev.problem.*`. */
const KNOWN = new Set(['no-tree', 'no-bytes', 'not-utf8', 'no-memory', 'cannot-open', 'cannot-save', 'not-found', 'no-access', 'disk-full', 'same-file', 'stopped', 'bad-key', 'bad-zone']);

/** What went wrong, as a key of the translations. */
export function problemKey(error: unknown): string {
  const code = error instanceof AppInvokeError ? error.code : null;
  return `dev.problem.${code !== null && KNOWN.has(code) ? code : 'failed'}`;
}
