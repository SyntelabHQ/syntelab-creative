import type { AppHost } from '@syntelab/shell-api';
import { PAGE_SOURCES } from './page-sources';

/**
 * Files dropped on the window or pasted. The interface gets their content
 * but not where they are on disk, so the content is handed to the Rust side,
 * which keeps a copy the engine can open.
 */

/** How much of a file goes over in one piece. A multiple of 3, so pieces of base64 join cleanly. */
const PIECE_BYTES = 3 * 1024 * 1024;
/** Larger files are not copied: the user opens them from where they are. */
const MAX_RECEIVED_BYTES = 600 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let text = '';
  // In stretches: one call per byte would be slow, one call for all overflows the stack.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(text);
}

/** A picture pasted from the screen has no name of its own. */
function nameOf(file: File, index: number): string {
  if (file.name && file.name !== 'image.png') return file.name;
  const ending = file.type.startsWith('image/') ? file.type.slice(6).replace('jpeg', 'jpg').replace('svg+xml', 'svg') : 'png';
  return `pasted-${index + 1}.${ending}`;
}

/** True for a file whose pages the program can take. */
export function canBecomePages(name: string): boolean {
  const ending = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return PAGE_SOURCES.includes(ending);
}

/** The files a drop or a paste carries; empty when it carries something else (text, a page being moved). */
export function filesOf(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  return [...transfer.files];
}

export interface Received {
  /** Where the copies are, in the order given. */
  readonly paths: string[];
  /** How many files were left out: not something that can become pages, or too large. */
  readonly skipped: number;
}

/** Hands the files to the Rust side and returns where it keeps them. */
export async function receiveFiles(host: Pick<AppHost, 'invoke'>, files: readonly File[]): Promise<Received> {
  const paths: string[] = [];
  let skipped = 0;
  for (const [index, file] of files.entries()) {
    const name = nameOf(file, index);
    if (!canBecomePages(name) || file.size > MAX_RECEIVED_BYTES || file.size === 0) {
      skipped += 1;
      continue;
    }
    try {
      let path: string | undefined;
      for (let start = 0; start < file.size; start += PIECE_BYTES) {
        const piece = new Uint8Array(await file.slice(start, start + PIECE_BYTES).arrayBuffer());
        const answer: { path: string } = await host.invoke('receive_file', path ? { into: path, data: toBase64(piece) } : { name, data: toBase64(piece) });
        path = answer.path;
      }
      if (path) paths.push(path);
    } catch {
      skipped += 1;
    }
  }
  return { paths, skipped };
}
