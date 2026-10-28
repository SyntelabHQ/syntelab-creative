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

/** The buttons of the title bar the program draws itself: minimize, maximize or put back, close (which asks first, as above). */
export async function minimizeWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().toggleMaximize();
}

export async function requestCloseWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
}

/** Calls `onChange` with whether the window fills the screen now (maximized), and each time that changes. */
export function watchMaximized(onChange: (maximized: boolean) => void): () => void {
  if (!isTauri()) return () => {};
  let stop: (() => void) | undefined;
  let stopped = false;
  void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
    const current = getCurrentWindow();
    const check = () => void current.isMaximized().then((maximized) => !stopped && onChange(maximized), () => {});
    check();
    const unlisten = await current.onResized(check);
    if (stopped) unlisten();
    else stop = unlisten;
  });
  return () => {
    stopped = true;
    stop?.();
  };
}

/** Whether the window is the program's own (Tauri), with no title bar of the system: the program draws its buttons. */
export function drawsOwnTitleBar(): boolean {
  return isTauri();
}
