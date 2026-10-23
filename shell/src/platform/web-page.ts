import { isTauri } from './tauri';

/**
 * Saves the web page at an address the user typed as a PDF at `destination`.
 * This is the one time the program goes to an address that is not
 * syntelab.com, and only when the user asks (crates/syntelab-net). Rejects
 * with an error whose message is `not-an-address`, `no-browser` or `failed`.
 */
/**
 * Reads the source (HTML) of the web page at an address the user typed: the
 * same kind of connection as `saveWebPage`, under the same rules. Rejects
 * with an error whose message is `not-an-address`, `no-browser` or `failed`.
 */
export async function readWebPage(address: string): Promise<string> {
  if (!isTauri()) throw new Error('failed');
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<string>('read_web_page', { address });
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'failed');
  }
}

export async function saveWebPage(address: string, destination: string): Promise<void> {
  if (!isTauri()) throw new Error('failed');
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke('save_web_page', { address, destination });
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'failed');
  }
}
