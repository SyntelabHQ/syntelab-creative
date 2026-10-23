import type { AppHost } from '@syntelab/shell-api';

/** A file the user opened, remembered on this computer only. */
export interface RecentFile {
  readonly path: string;
  /** When it was last opened: milliseconds since 1970. */
  readonly openedAt: number;
}

const DATA_KEY = 'recent-files';
const MAX_RECENT_FILES = 12;

/** Puts `path` first in the list, without duplicates, and trims the list. */
export function withRecentFile(files: readonly RecentFile[], path: string, openedAt: number): RecentFile[] {
  return [{ path, openedAt }, ...files.filter((file) => file.path !== path)].slice(0, MAX_RECENT_FILES);
}

function isRecentFile(value: unknown): value is RecentFile {
  if (typeof value !== 'object' || value === null) return false;
  const { path, openedAt } = value as Record<string, unknown>;
  return typeof path === 'string' && typeof openedAt === 'number';
}

/** The recent files, newest first. */
export function loadRecentFiles(host: AppHost): RecentFile[] {
  const stored = host.loadData<unknown>(DATA_KEY);
  return Array.isArray(stored) ? stored.filter(isRecentFile) : [];
}

/** Called when a file has opened successfully. */
export function rememberFile(host: AppHost, path: string): void {
  host.saveData(DATA_KEY, withRecentFile(loadRecentFiles(host), path, Date.now()));
}

export function clearRecentFiles(host: AppHost): void {
  host.saveData(DATA_KEY, []);
}
