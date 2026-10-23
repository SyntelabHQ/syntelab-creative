import { fileName } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { loadSettings } from '../settings/organizer-settings';
import { newDocumentName, withoutExtension } from './names';
import { openFileInTab } from './open-file';
import type { RequestedPage } from './page-plan';
import { planFromDocument, planRequest } from './page-plan';
import { openAsPages } from './page-sources';

/**
 * Drafts: PDFs the program made that the user has not saved anywhere yet
 * (pages taken out of a document, files combined, a picture turned into a
 * PDF). The Rust side keeps the file; a tab shows it like any other PDF,
 * marked as unsaved, and "Save" asks where.
 */

/** Opens a draft in its own tab. */
export function openDraftTab(host: Pick<AppHost, 'openTab'>, path: string): void {
  host.openTab({ key: path, title: fileName(path), params: { path, unsaved: '1' } });
}

/** Writes pages of open documents as a draft called `name`, and returns where it is. */
export async function writeDraft(
  host: Pick<AppHost, 'invoke'>,
  name: string,
  pages: readonly RequestedPage[],
  baseDocumentId?: number,
): Promise<string> {
  const { path } = await host.invoke<{ path: string }>('new_draft', { name, pages, baseDocumentId });
  return path;
}

const COUNT_KEY = 'new-document-count';

/** The name for the next document made new: `syntelab_pdf_00001`, then 00002… (the pattern is a setting). */
export function nextNewName(host: Pick<AppHost, 'loadData' | 'saveData'>): string {
  const stored = host.loadData<unknown>(COUNT_KEY);
  const number = (typeof stored === 'number' && Number.isFinite(stored) ? Math.max(Math.floor(stored), 0) : 0) + 1;
  host.saveData(COUNT_KEY, number);
  return newDocumentName(loadSettings(host).newName, number);
}

/**
 * Turns a file that is not a PDF (a picture, a text file, an office
 * document…) into a draft with the same name, and returns where it is.
 */
async function fileAsDraft(host: Pick<AppHost, 'invoke'>, path: string): Promise<string> {
  const opened = await openAsPages(host, path);
  try {
    const pages = planRequest(planFromDocument(opened.documentId, opened.pageSizes));
    return await writeDraft(host, `${withoutExtension(fileName(path))}.pdf`, pages, opened.documentId);
  } finally {
    void host.invoke('close_document', { documentId: opened.documentId }).catch(() => {});
  }
}

/**
 * Opens each file in a tab of its own: a PDF as it is, anything else as an
 * unsaved PDF made from it. Returns the files that could not be opened, each
 * with what went wrong.
 */
export async function openFilesInTabs(host: AppHost, paths: readonly string[]): Promise<{ path: string; error: unknown }[]> {
  const failed: { path: string; error: unknown }[] = [];
  for (const path of paths) {
    if (/\.pdf$/i.test(path)) {
      openFileInTab(host, path);
      continue;
    }
    try {
      openDraftTab(host, await fileAsDraft(host, path));
    } catch (error) {
      failed.push({ path, error });
    }
  }
  return failed;
}
