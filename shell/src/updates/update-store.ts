import { receiveRemoteChangelog } from '../changelog';
import { resolveLanguage } from '../i18n';
import { fetchRemoteFile } from '../platform';
import { preferences, updatePreferences } from '../preferences';
import { createStore, useStore } from '../state/create-store';
import { compareVersions } from './compare-versions';
import { parseUpdateInfo } from './update-info';
import type { UpdateInfo } from './update-info';

/** The version of the program that is running. */
export const APP_VERSION: string = __APP_VERSION__;

export type UpdateState =
  | { readonly status: 'idle' }
  | { readonly status: 'checking' }
  | { readonly status: 'current' }
  | { readonly status: 'available'; readonly info: UpdateInfo }
  /** The check could not be made (offline, website unreachable). */
  | { readonly status: 'failed' };

const state = createStore<UpdateState>({ status: 'idle' });
const dialogOpen = createStore(false);

export function useUpdateState(): UpdateState {
  return useStore(state);
}

export function useUpdateDialogOpen(): boolean {
  return useStore(dialogOpen);
}

export function openUpdateDialog(): void {
  dialogOpen.set(true);
}

export function closeUpdateDialog(): void {
  dialogOpen.set(false);
}

/**
 * Takes in an update file read from syntelab.com. A newer version is announced
 * in a window; with `quiet`, only the first time that version is seen.
 */
function receiveUpdateFile(file: unknown, { quiet = false } = {}): void {
  const info = parseUpdateInfo(file);
  if (!info) throw new Error('the update file names no version');
  if (compareVersions(info.latest, APP_VERSION) <= 0) {
    state.set({ status: 'current' });
    return;
  }
  state.set({ status: 'available', info });
  const alreadyTold = preferences.get().updateNotifiedVersion === info.latest;
  if (!quiet || !alreadyTold) {
    updatePreferences({ updateNotifiedVersion: info.latest });
    openUpdateDialog();
  }
}

/**
 * Asks syntelab.com for the newest version, and takes the newer changelog
 * along. `quiet` is for the check made at start: a failure is then not shown.
 */
export async function checkForUpdates({ quiet = false } = {}): Promise<void> {
  if (state.get().status === 'checking') return;
  const before = state.get();
  state.set({ status: 'checking' });

  // The changelog is a bonus of the same visit; the check does not depend on it.
  void readRemoteChangelog();

  try {
    receiveUpdateFile(await fetchRemoteFile('update'), { quiet });
  } catch {
    state.set(quiet ? before : { status: 'failed' });
  }
}

/** The changelog of the language shown, or the English one when that language has none. */
async function readRemoteChangelog(): Promise<void> {
  const language = resolveLanguage(preferences.get().language);
  for (const tried of language === 'en' ? ['en'] : [language, 'en']) {
    try {
      receiveRemoteChangelog(await fetchRemoteFile(`changelog/${tried}`), tried);
      return;
    } catch {
      // Not published in this language (or offline): try the next one.
    }
  }
}

let startedOnce = false;

/** The check at start, made only when the user allows online checks. */
export function checkForUpdatesAtStart(): void {
  if (startedOnce) return;
  startedOnce = true;
  if (preferences.get().onlineChecks) void checkForUpdates({ quiet: true });
}
