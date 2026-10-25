import { isTauri } from '../platform/tauri';
import type { AppTabRequest } from '@syntelab/shell-api';

/** The app a window opens in when nothing says which (the browser preview without `?app=`). */
const FIRST_APP = 'pdf-organizer';

/**
 * The app this window is for: each app has a window of its own. The Rust side says which before the page runs;
 * the browser preview takes it from the address (`?app=units`).
 */
export const WINDOW_APP: string = typeof window === 'undefined' ? FIRST_APP : (window.__SYNTELAB_WINDOW_APP__ ?? new URLSearchParams(window.location.search).get('app') ?? FIRST_APP);

/**
 * Opens another app in its own window, or brings that window to the front when it is open, with a tab to open
 * there. Undefined in the browser preview, which has one page only: there the app opens in a tab.
 */
export const openAppWindow: ((appId: string, request?: AppTabRequest) => void) | undefined = typeof window !== 'undefined' && isTauri()
  ? (appId, request) => {
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('open_app_window', { id: appId, tab: request ?? null }))
        .catch((error: unknown) => console.error('[windows] could not open the app', appId, error));
    }
  : undefined;
