/** True inside the Tauri window, false in a plain browser (`npm run dev:web`). */
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}
