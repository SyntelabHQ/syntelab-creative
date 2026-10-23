import type { Translate } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { openFilesInTabs } from './drafts';
import { PAGE_SOURCES, pageSourceProblem } from './page-sources';

export interface OpenedFiles {
  /** How many files the user chose. */
  readonly chosen: number;
  /** Translation key of what went wrong with one of them, or null. */
  readonly problem: string | null;
}

/**
 * Asks the user for a file (or several at once) and opens each in its own
 * tab: a PDF as it is; a picture, a text file or any other document as an
 * unsaved PDF made from it.
 */
export async function pickAndOpenFiles(host: AppHost, t: Translate, several: boolean): Promise<OpenedFiles> {
  const paths = await host.pickFiles({
    typeName: t('pdf-organizer.open.pagesType'),
    extensions: [...PAGE_SOURCES],
    multiple: several,
  });
  const failed = await openFilesInTabs(host, paths);
  return { chosen: paths.length, problem: failed[0] ? pageSourceProblem(failed[0].error) : null };
}
