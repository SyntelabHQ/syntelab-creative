import { isTauri } from './tauri';

/** What the Rust side says (`default_pdf_app_state`, see `src-tauri/src/default_app.rs`). */
interface DefaultAppState {
  readonly supported: boolean;
  readonly isDefault: boolean;
}

/**
 * Whether the user chose this program for PDF files: null where it cannot be
 * chosen (another system than Windows, a plain browser, a program not registered).
 */
export async function isDefaultPdfApp(): Promise<boolean | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const state = await invoke<DefaultAppState>('default_pdf_app_state');
  return state.supported ? state.isDefault : null;
}

/** Opens the system's settings where the user makes the program the default for PDF files. */
export async function openDefaultAppSettings(): Promise<void> {
  if (!isTauri()) throw new Error('default apps can only be chosen from the installed program');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_default_app_settings');
}
