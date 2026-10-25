import { fileName } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';

/** Opens a PDF in its own tab (or brings its tab to the front). */
export function openFileInTab(host: Pick<AppHost, 'openTab'>, path: string): void {
  host.openTab({ key: path, title: fileName(path), params: { path } });
}

let binderCount = 0;

/**
 * Opens a new binder tab. With `paths`, the binder starts with those files
 * as its cards, in that order.
 */
export function openBinderTab(host: Pick<AppHost, 'openTab'>, title: string, paths: readonly string[] = []): void {
  binderCount += 1;
  host.openTab({
    key: `binder:${Date.now()}:${binderCount}`,
    title,
    params: paths.length > 0 ? { binder: '1', files: JSON.stringify(paths) } : { binder: '1' },
  });
}

/** The files a binder tab was asked to start with. */
export function binderStartFiles(params: Readonly<Record<string, string>>): string[] {
  try {
    const paths: unknown = JSON.parse(params.files ?? '[]');
    return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Opens the tab that does one thing to many files. With `paths`, it starts
 * with those files; `kind` is the thing to do it starts with.
 */
export function openBatchTab(host: Pick<AppHost, 'openTab'>, title: string, paths: readonly string[] = [], kind?: string): void {
  host.openTab({
    // One such tab is enough (one for each thing asked for): asking again brings it to the front, unless it is asked for with files of its own.
    key: paths.length > 0 ? `batch:${Date.now()}` : kind ? `batch:${kind}` : 'batch',
    title,
    params: { batch: '1', ...(paths.length > 0 ? { files: JSON.stringify(paths) } : {}), ...(kind ? { kind } : {}) },
  });
}

/**
 * Opens "Sign many files": the batch tab made for signing only, with nothing
 * else to choose. With `paths`, it starts with those files.
 */
export function openSignBatchTab(host: Pick<AppHost, 'openTab'>, title: string, paths: readonly string[] = []): void {
  host.openTab({
    // One such tab is enough: asking again brings it to the front, unless it is asked for with files of its own.
    key: paths.length > 0 ? `sign-batch:${Date.now()}` : 'sign-batch',
    title,
    params: { batch: '1', signing: '1', kind: 'sign', ...(paths.length > 0 ? { files: JSON.stringify(paths) } : {}) },
  });
}

/** Opens a tab that compares two files page by page. */
export function openCompareTab(host: AppHost, title: string, first: string, second: string): void {
  host.openTab({ key: `compare:${first}|${second}`, title, params: { compare: '1', first, second } });
}
