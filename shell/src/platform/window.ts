import { isTauri } from './tauri';

/** Makes the program window cover the whole screen, or puts it back. */
export async function setFullScreen(on: boolean): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setFullscreen(on);
    return;
  }
  // Browser preview: the page itself goes full screen.
  if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
  if (!on && document.fullscreenElement) await document.exitFullscreen();
}

/**
 * Asks `mayClose` whenever the user closes the program window. It returns
 * true to let the window close, false to keep it open (and then calls
 * `closeWindow` itself once the user agrees). Returns a function that stops
 * asking. In the browser preview there is no window to guard.
 */
export function onWindowCloseRequested(mayClose: () => boolean): () => void {
  if (!isTauri()) return () => {};
  let stop: (() => void) | undefined;
  let stopped = false;
  void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
    const unlisten = await getCurrentWindow().onCloseRequested((event) => {
      if (!mayClose()) event.preventDefault();
    });
    if (stopped) unlisten();
    else stop = unlisten;
  });
  return () => {
    stopped = true;
    stop?.();
  };
}

/** Closes the program window without asking again. */
export async function closeWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().destroy();
}
