import { isTauri } from './tauri';

/** Opens the folder of a file in the system's file manager, with the file selected. */
export async function showInFolder(path: string): Promise<void> {
  if (!isTauri()) throw new Error('folders can only be opened from the installed program');
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}
