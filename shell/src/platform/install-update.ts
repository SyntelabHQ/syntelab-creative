import { isTauri } from './tauri';

/** How far a download has come: bytes so far, and in all when the server says. */
export interface InstallProgress {
  readonly done: number;
  readonly total?: number;
}

/**
 * Downloads the newest version, checks it against the program's public key,
 * installs it and starts the program again. Called only after the user chose
 * "Update". Rejects when there is nothing this copy can install by itself (a
 * portable copy, a Linux package, no network, a file not signed by us); the
 * user then still has the download page.
 */
export async function installUpdate(onProgress: (progress: InstallProgress) => void): Promise<void> {
  if (!isTauri()) throw new Error('updates are installed only by the installed program');
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) throw new Error('no newer version to install');
  let done = 0;
  let total: number | undefined;
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') total = event.data.contentLength ?? undefined;
    if (event.event === 'Progress') done += event.data.chunkLength;
    onProgress({ done, total });
  });
  // On Windows the installer has already closed the program; elsewhere it starts again here.
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
