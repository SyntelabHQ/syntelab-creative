import { AppInvokeError } from '@syntelab/shell-api';
import type { AppInvokeErrorKind, PickFilesOptions, PickSavePathOptions } from '@syntelab/shell-api';
import { isTauri } from './tauri';

const RESOURCE_SCHEME = 'syntelab-app';

interface BackendError {
  readonly kind: AppInvokeErrorKind;
  readonly code: string | null;
  readonly detail: string;
}

function isBackendError(value: unknown): value is BackendError {
  return typeof value === 'object' && value !== null && 'kind' in value && 'detail' in value;
}

const unavailable = () =>
  new AppInvokeError('unavailable', null, 'the Rust side only exists in the installed program');

/** Runs a command of an app's Rust side (`app_invoke` in shell/src-tauri). */
export async function invokeApp<T>(appId: string, command: string, payload?: unknown): Promise<T> {
  if (!isTauri()) throw unavailable();
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>('app_invoke', { appId, command, payload });
  } catch (error) {
    if (isBackendError(error)) throw new AppInvokeError(error.kind, error.code, error.detail);
    throw new AppInvokeError('failed', null, String(error));
  }
}

/**
 * Start of every resource URL. Tauri serves custom schemes as
 * `http://<scheme>.localhost/` on Windows and `<scheme>://localhost/` elsewhere.
 */
function resourceBase(): string {
  const windows = navigator.userAgent.includes('Windows');
  return windows ? `http://${RESOURCE_SCHEME}.localhost/` : `${RESOURCE_SCHEME}://localhost/`;
}

/** URL of binary data produced by an app's Rust side. */
export function appResourceUrl(
  appId: string,
  path: string,
  query: Readonly<Record<string, string | number>> = {},
): string {
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const suffix = search.size > 0 ? `?${search}` : '';
  return `${resourceBase()}${appId}/${path}${suffix}`;
}

/** Shows the system's "open file" dialog. Returns the chosen paths. */
export async function pickFiles(options: PickFilesOptions): Promise<string[]> {
  if (!isTauri()) return [];
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    multiple: options.multiple ?? false,
    filters: [{ name: options.typeName, extensions: [...options.extensions] }],
  });
  if (picked === null) return [];
  return Array.isArray(picked) ? picked : [picked];
}

/** Shows the system's "choose folder" dialog. Returns the chosen path, or null when cancelled. */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === 'string' ? picked : null;
}

/** Shows the system's "save file" dialog. Returns the chosen path, or null when cancelled. */
export async function pickSavePath(options: PickSavePathOptions): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import('@tauri-apps/plugin-dialog');
  return save({
    defaultPath: options.suggestedName,
    filters: options.types && options.types.length > 0 ? options.types.map((type) => ({ name: type.name, extensions: [...type.extensions] })) : [{ name: options.typeName, extensions: [options.extension] }],
  });
}

interface WebViewWithFiles {
  postMessageWithAdditionalObjects(message: string, objects: readonly File[]): void;
}

/** WebView2's own object in the page, on Windows; it can hand over dropped files with their paths. */
function webView(): WebViewWithFiles | null {
  const chrome = (window as { chrome?: { webview?: Partial<WebViewWithFiles> } }).chrome;
  return typeof chrome?.webview?.postMessageWithAdditionalObjects === 'function' ? (chrome.webview as WebViewWithFiles) : null;
}

/** Same names as in shell/src-tauri/src/dropped_files.rs. */
const DROPPED_MESSAGE = 'syntelab:dropped-files';
const DROPPED_EVENT = 'dropped-file-paths';
/** The answer comes at once; past this something went wrong and the content is used instead. */
const DROPPED_WAIT_MS = 2000;

/** Asks the window where the dropped files are. Null when it cannot say. */
export async function pathsOfDropped(files: readonly File[]): Promise<readonly string[] | null> {
  const view = isTauri() ? webView() : null;
  if (view === null || files.length === 0) return null;
  // This window's own: each app has a window, and the paths come back to the one they were dropped on.
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const listen = getCurrentWebviewWindow().listen.bind(getCurrentWebviewWindow());
  let stop = () => {};
  try {
    return await new Promise<readonly string[] | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), DROPPED_WAIT_MS);
      void listen<string[]>(DROPPED_EVENT, (event) => {
        window.clearTimeout(timer);
        // Only when every file has its path: the order then matches the files.
        resolve(event.payload.length === files.length ? event.payload : null);
      }).then((unlisten) => {
        stop = unlisten;
        try {
          view.postMessageWithAdditionalObjects(DROPPED_MESSAGE, files);
        } catch {
          window.clearTimeout(timer);
          resolve(null);
        }
      });
    });
  } finally {
    stop();
  }
}
