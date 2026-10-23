import { AppInvokeError, fileName } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { loadPicture } from './load-picture';
import type { OpenedDocument } from './use-document';

/** Pictures, in every format the program reads (the Rust side, or the web view). */
export const PICTURE_TYPES = [
  'png', 'jpg', 'jpeg', 'jpe', 'jfif', 'bmp', 'dib', 'gif', 'tif', 'tiff', 'webp', 'avif', 'svg', 'ico',
  'pnm', 'pbm', 'pgm', 'ppm', 'pam', 'jp2', 'jpx', 'j2k', 'jpf', 'psd', 'apng', 'cur',
] as const;
/** Plain text and web pages: laid out as pages. */
const TEXT_TYPES = ['txt', 'text', 'log', 'md', 'markdown', 'csv', 'tsv', 'ini', 'json', 'xml', 'yaml', 'yml', 'html', 'htm', 'xhtml'] as const;
/** Other documents the engine reads: e-books, XPS, comic book archives. */
const DOCUMENT_TYPES = ['epub', 'fb2', 'mobi', 'xps', 'oxps', 'cbz'] as const;
/** Office documents: converted by the office suite on the computer. */
const OFFICE_TYPES = [
  'docx', 'doc', 'docm', 'dotx', 'dot', 'rtf', 'odt', 'ott', 'wps',
  'xlsx', 'xls', 'xlsm', 'xlsb', 'xltx', 'xlt', 'ods', 'ots',
  'pptx', 'ppt', 'pptm', 'ppsx', 'pps', 'potx', 'pot', 'odp', 'otp',
] as const;

/** Every file whose pages can be combined or inserted. */
export const PAGE_SOURCES: readonly string[] = ['pdf', ...PICTURE_TYPES, ...TEXT_TYPES, ...DOCUMENT_TYPES, ...OFFICE_TYPES];

/**
 * Opens a file to take pages from: a PDF as it is; a picture, a text file or
 * an office document as a document of the program's own made from it. The
 * caller closes it (`close_document`) when it is done with the pages.
 */
export async function openAsPages(host: Pick<AppHost, 'invoke'>, path: string): Promise<OpenedDocument> {
  try {
    return await host.invoke<OpenedDocument>('open_document', { path, asPages: true });
  } catch (error) {
    // A picture only the web view can read: decode it here and hand the pixels over.
    if ((error as { code?: unknown } | null)?.code !== 'decode-in-interface') throw error;
    const picture = await loadPicture(host, path);
    return host.invoke<OpenedDocument>('open_document', {
      picture: picture.address.slice(picture.address.indexOf(',') + 1),
      name: fileName(path),
      asPages: true,
    });
  }
}

/** The problem to show when a file could not be opened as pages. */
export function pageSourceProblem(error: unknown): string {
  const code = error instanceof AppInvokeError ? error.code : null;
  if (code === 'needs-office') return 'pdf-organizer.error.needsOffice';
  if (code === 'office-timed-out') return 'pdf-organizer.error.officeTimedOut';
  return 'pdf-organizer.error.insertFailed';
}
