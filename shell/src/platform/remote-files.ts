import { isTauri } from './tauri';

/** The files of syntelab.com the program may read (crates/syntelab-net). */
/** `changelog/<language>` is the changelog of one language, like `changelog/ro`. */
export type RemoteFile = 'update' | `changelog/${string}`;

/**
 * Reads one of the known files from syntelab.com. This is the interface's
 * only way to the network; it is used only when the user allows online checks
 * or asks for one. Rejects when offline, and in a plain browser.
 */
export async function fetchRemoteFile(file: RemoteFile): Promise<unknown> {
  if (!isTauri()) throw new Error('the network module only exists in the installed program');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<unknown>('fetch_remote_file', { file });
}
