import type { AppHost } from '@syntelab/shell-api';

/** A text file the user opened or saved, remembered on this computer only. */
export interface RecentText {
  readonly path: string;
  /** When it was last opened or saved: milliseconds since 1970. */
  readonly openedAt: number;
}

const DATA_KEY = 'recent-texts';
export const MOST_RECENT_TEXTS = 12;

/** The list with `path` first, once, and no longer than it is kept. */
export function withRecentText(texts: readonly RecentText[], path: string, openedAt: number): RecentText[] {
  return [{ path, openedAt }, ...texts.filter((text) => text.path !== path)].slice(0, MOST_RECENT_TEXTS);
}

function isRecentText(value: unknown): value is RecentText {
  if (typeof value !== 'object' || value === null) return false;
  const { path, openedAt } = value as Record<string, unknown>;
  return typeof path === 'string' && path !== '' && typeof openedAt === 'number';
}

/** The recent texts, newest first. */
export function loadRecentTexts(host: Pick<AppHost, 'loadData'>): RecentText[] {
  const stored = host.loadData<unknown>(DATA_KEY);
  return Array.isArray(stored) ? stored.filter(isRecentText).slice(0, MOST_RECENT_TEXTS) : [];
}

/** Called when a file was opened or saved. */
export function rememberText(host: Pick<AppHost, 'loadData' | 'saveData'>, path: string): void {
  host.saveData(DATA_KEY, withRecentText(loadRecentTexts(host), path, Date.now()));
}

export function forgetRecentTexts(host: Pick<AppHost, 'saveData'>): void {
  host.saveData(DATA_KEY, []);
}
