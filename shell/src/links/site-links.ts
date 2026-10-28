import { languageRegistry } from '../i18n';
import { openExternal } from '../platform';
import { preferences } from '../preferences';
import { createStore } from '../state/create-store';

/** Pages on syntelab.com the program links to. */
export type SitePage = 'support' | 'feedback';

/** `syntelab.com/<page>`, or `syntelab.com/<lang>/<page>` for other languages. */
function siteUrl(page: SitePage, language: string): string {
  const prefix = language === languageRegistry.source ? '' : `/${language}`;
  return `https://syntelab.com${prefix}/${page}`;
}

/** Opens a syntelab.com page in the user's browser, in the program's language, straight away. */
export function openSitePageNow(page: SitePage): void {
  void openExternal(siteUrl(page, document.documentElement.lang || languageRegistry.source));
}

/** The page whose window is shown (what it is for, before the browser opens it), or null. */
export const siteNotice = createStore<SitePage | null>(null);

/**
 * Opens a syntelab.com page: first a small window says what the page is for
 * and asks before the browser opens, unless the user chose to skip it.
 */
export function openSitePage(page: SitePage): void {
  if (preferences.get().siteNoticesOff.includes(page)) openSitePageNow(page);
  else siteNotice.set(page);
}
