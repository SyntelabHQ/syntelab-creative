import { isTauri } from './tauri';

/**
 * Offers a file to the system's "Share" window. On a system without one the
 * file is shown, selected, in its folder, from where it can be sent anywhere.
 */
export async function shareFile(path: string): Promise<void> {
  if (!isTauri()) throw new Error('files can only be shared from the installed program');
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke('share_file', { path });
  } catch (error) {
    if (String(error) !== 'unsupported') throw error;
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(path);
  }
}
