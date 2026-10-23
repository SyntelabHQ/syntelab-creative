import { AppInvokeError } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';

/** How the lines of a file end: Linux and macOS, Windows, old Mac. */
export const LINE_ENDINGS = ['lf', 'crlf', 'cr'] as const;
export type LineEnding = (typeof LINE_ENDINGS)[number];

/** How a text is kept in its file. The text itself always has `\n` between its lines. */
export interface FileForm {
  /** The name of the encoding as the web names it: `UTF-8`, `windows-1250`… */
  readonly encoding: string;
  /** The file starts with a byte order mark. */
  readonly mark: boolean;
  readonly lineEnding: LineEnding;
}

/** A text as `open_file` gives it. */
export interface OpenedText extends FileForm {
  readonly text: string;
  /** The file has lines that end in different ways; saving gives them all the same ending. */
  readonly mixedEndings: boolean;
  /** Some bytes were not text in that encoding; they show as `�`. */
  readonly damaged: boolean;
}

/** What a text that has no file yet is saved as, unless the user chooses otherwise: `wanted` is what the settings say. */
export function newFileForm(wanted: { readonly newLineEnding: 'system' | 'crlf' | 'lf'; readonly newMark: boolean } = { newLineEnding: 'system', newMark: false }, platform: string = navigator.platform): FileForm {
  const lineEnding = wanted.newLineEnding === 'system' ? (/win/i.test(platform) ? 'crlf' : 'lf') : wanted.newLineEnding;
  return { encoding: 'UTF-8', mark: wanted.newMark, lineEnding };
}

type Invoke = Pick<AppHost, 'invoke'>;

/**
 * Reads a text file; `encoding` says how to read its bytes when the guess was wrong. A file too large for the
 * editor is refused (`too-large`) unless `whole` asks for it all the same.
 */
export function openText(host: Invoke, path: string, encoding?: string, whole = false): Promise<OpenedText> {
  return host.invoke<OpenedText>('open_file', { path, ...(encoding ? { encoding } : {}), ...(whole ? { whole: true } : {}) });
}

/** True for the refusal of a file too large for the editor. */
export function isTooLarge(error: unknown): boolean {
  return error instanceof AppInvokeError && error.code === 'too-large';
}

export function saveText(host: Invoke, path: string, text: string, form: FileForm): Promise<void> {
  return host.invoke('save_file', { path, text, ...form });
}

/** What went wrong with a file, as a key of the translations, with what the message needs. */
export function fileProblem(error: unknown, fallback: string): { readonly key: string; readonly values?: Readonly<Record<string, string>> } {
  const code = error instanceof AppInvokeError ? error.code : null;
  if (code === 'not-text') return { key: 'scribe.problem.notText' };
  if (code === 'unknown-encoding') return { key: 'scribe.problem.unknownEncoding' };
  if (code === 'cannot-encode') {
    // The Rust side puts the letter that cannot be written first, after the code.
    const letter = error instanceof AppInvokeError ? ([...error.message.replace(/^cannot-encode:\s*/, '')][0] ?? '') : '';
    return { key: 'scribe.problem.cannotEncode', values: { letter } };
  }
  return { key: fallback };
}
