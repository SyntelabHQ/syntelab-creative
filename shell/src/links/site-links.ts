import { languageRegistry } from '../i18n';
import { openExternal } from '../platform';

/** Pages on syntelab.com the program links to. */
export type SitePage = 'support' | 'feedback';

/** `syntelab.com/<page>`, or `syntelab.com/<lang>/<page>` for other languages. */
function siteUrl(page: SitePage, language: string): string {
  const prefix = language === languageRegistry.source ? '' : `/${language}`;
  return `https://syntelab.com${prefix}/${page}`;
}

/** Opens a syntelab.com page in the user's browser, in the program's language. */
export function openSitePage(page: SitePage): void {
  void openExternal(siteUrl(page, document.documentElement.lang || languageRegistry.source));
}
