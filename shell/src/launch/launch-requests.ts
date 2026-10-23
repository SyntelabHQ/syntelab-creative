import { fileName } from '@syntelab/shell-api';
import type { AppEntry, AppTabRequest } from '@syntelab/shell-api';

/**
 * What the program was started with (see `src-tauri/src/launch.rs`): files to
 * open, or an entry of the file manager's right-click menu with the files it
 * was chosen on.
 */
export interface LaunchRequest {
  /** The app the entry belongs to, and which entry; both null for files that are simply opened. An app without an entry is the shortcut of that app. */
  readonly app: string | null;
  readonly action: string | null;
  readonly files: readonly string[];
}

/** A tab to open for a request: in which app, and with what. */
export interface LaunchedTab {
  readonly appId: string;
  readonly request: AppTabRequest;
}

/**
 * Requests that belong together, as one: the file manager starts the program
 * once for each file chosen, and an entry chosen on five files is one thing
 * to do, not five.
 */
export function mergedRequests(requests: readonly LaunchRequest[]): LaunchRequest[] {
  const merged: { app: string | null; action: string | null; files: string[] }[] = [];
  for (const request of requests) {
    const same = merged.find((known) => known.app === request.app && known.action === request.action);
    const files = same?.files ?? [];
    for (const file of request.files) if (!files.includes(file)) files.push(file);
    if (!same) merged.push({ app: request.app, action: request.action, files });
  }
  return merged;
}

/** How long to wait for more of the same before acting, in milliseconds: the file manager starts the program once per file. */
const GATHERING = 400;

/**
 * Gathers requests that come one after another and hands them to `act`
 * merged (see `mergedRequests`), once none has come for `wait` milliseconds.
 */
export function requestGatherer(act: (requests: LaunchRequest[]) => void, wait = GATHERING) {
  let gathered: LaunchRequest[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    add(requests: readonly LaunchRequest[]) {
      if (requests.length === 0) return;
      gathered.push(...requests);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const merged = mergedRequests(gathered);
        gathered = [];
        act(merged);
      }, wait);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

const endingOf = (path: string) => (fileName(path).includes('.') ? fileName(path).slice(fileName(path).lastIndexOf('.')).toLowerCase() : '');

/**
 * The tabs a request opens. An entry of the menu opens one tab of its app,
 * which is told the entry (`launch`) and the files (`files`, as JSON). Files
 * alone are each opened by the app that says it takes their kind
 * (`fileTypes` in its manifest), with the file as `path`; a file no app
 * takes is passed over. The shortcut of an app opens that app first (the
 * first page of the app, in front unless files follow). `stamp` tells tabs of different requests apart.
 */
export function tabsFor(request: LaunchRequest, apps: readonly AppEntry[], stamp: string): LaunchedTab[] {
  const usable = apps.filter((app) => app.manifest.status === 'active');
  if (request.app !== null && request.action !== null) {
    const app = usable.find((known) => known.manifest.id === request.app);
    // Only what the app itself declared is handed to it.
    if (!app?.manifest.contextMenu?.some((entry) => entry.id === request.action)) return [];
    return [{ appId: app.manifest.id, request: { key: `launch:${stamp}`, params: { launch: request.action, files: JSON.stringify(request.files) } } }];
  }
  // The shortcut of an app (Start menu, desktop): the program opens in that app, then opens the files it was given.
  const shortcut = request.app !== null && request.action === null ? usable.find((known) => known.manifest.id === request.app) : undefined;
  const opened = request.files.flatMap((file) => {
    const app = usable.find((known) => known.manifest.fileTypes?.some((type) => type.toLowerCase() === endingOf(file)));
    return app ? [{ appId: app.manifest.id, request: { key: file, title: fileName(file), params: { path: file } } }] : [];
  });
  return shortcut ? [{ appId: shortcut.manifest.id, request: {} }, ...opened] : opened;
}
