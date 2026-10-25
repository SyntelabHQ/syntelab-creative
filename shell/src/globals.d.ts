/** The program's version, from `shell/src-tauri/tauri.conf.json` (set by Vite). */
declare const __APP_VERSION__: string;

interface Window {
  /** The app this window is for, set by the Rust side before the page runs (`src-tauri/src/app_windows.rs`). */
  __SYNTELAB_WINDOW_APP__?: string;
}
