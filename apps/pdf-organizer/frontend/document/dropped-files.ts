import type { AppHost } from '@syntelab/shell-api';
import { openDraftTab, openFilesInTabs } from './drafts';
import { pageSourceProblem } from './page-sources';
import { canBecomePages, receiveFiles } from './received-files';

/**
 * Files dropped on the window or pasted, opened as Adobe Acrobat does: each in
 * a tab of its own. Where the window can say where a file is on disk, a PDF
 * opens as the file itself (Save writes back to it); otherwise only its
 * content is known, and it opens as an unsaved copy. Anything else (a
 * picture, a text, an office document) becomes an unsaved PDF.
 */

export interface LocatedFiles {
  /** Where the files are, in the order given: their own places, or the copies the Rust side keeps. */
  readonly paths: string[];
  /** True when the paths are copies, not the files themselves. */
  readonly copies: boolean;
  /** How many files were left out: not something that can become pages, or not readable. */
  readonly skipped: number;
}

/** Finds where dropped or pasted files are: on disk when the window can say, else copies handed to the Rust side. */
export async function locateFiles(host: Pick<AppHost, 'invoke' | 'pathsOfDropped'>, files: readonly File[]): Promise<LocatedFiles> {
  const own = await host.pathsOfDropped(files).catch(() => null);
  if (own !== null) {
    const paths = own.filter(canBecomePages);
    return { paths, copies: false, skipped: own.length - paths.length };
  }
  const received = await receiveFiles(host, files);
  return { paths: received.paths, copies: true, skipped: received.skipped };
}

/**
 * Opens dropped or pasted files, each in its own tab. Returns how many were
 * given and the translation key of what went wrong, or null.
 */
export async function openDroppedFiles(host: AppHost, files: readonly File[]): Promise<{ chosen: number; problem: string | null }> {
  const located = await locateFiles(host, files);
  const failed: unknown[] = [];
  for (const path of located.paths) {
    // A copy of a PDF is not the user's file: it opens as unsaved, and Save asks where.
    if (located.copies && /\.pdf$/i.test(path)) {
      openDraftTab(host, path);
      continue;
    }
    for (const { error } of await openFilesInTabs(host, [path])) failed.push(error);
  }
  const problem = failed.length > 0 ? pageSourceProblem(failed[0]) : located.skipped > 0 ? 'pdf-organizer.error.someFilesSkipped' : null;
  return { chosen: files.length, problem };
}
