import type { AppTabRequest } from '@syntelab/shell-api';
import { useEffect, useRef } from 'react';
import { useApps } from '../apps';
import { isTauri } from '../platform';
import { tabs } from '../tabs';
import { requestGatherer, tabsFor } from './launch-requests';
import type { LaunchRequest } from './launch-requests';

/** What waits for this window (`take_window_requests` in `src-tauri/src/app_windows.rs`). */
interface WindowRequests {
  readonly launches: LaunchRequest[];
  /** Tabs another window asked to open here (the search, an app). */
  readonly tabs: AppTabRequest[];
}

/**
 * Does what was sent to this window: what the program was started with, when
 * it starts and whenever a second copy hands its own start over, and the tabs
 * other windows ask for. Waits until the apps are known, since they say which
 * files and entries are theirs.
 */
export function useLaunchRequests(): void {
  const { status, apps } = useApps();
  const known = useRef(apps);
  known.current = apps;
  const ready = status === 'ready';

  useEffect(() => {
    if (!ready || !isTauri()) return;
    let stopped = false;
    let stopListening = () => {};
    let count = 0;

    const gatherer = requestGatherer((requests) => {
      for (const request of requests) {
        count += 1;
        for (const tab of tabsFor(request, known.current, `${Date.now().toString(36)}-${count}`)) tabs.openApp(tab.appId, tab.request);
      }
    });
    const take = async () => {
      if (stopped) return;
      const { invoke } = await import('@tauri-apps/api/core');
      const waiting = await invoke<WindowRequests>('take_window_requests');
      if (stopped) return;
      for (const request of waiting.tabs) tabs.openApp(tabs.homeApp, request);
      gatherer.add(waiting.launches);
    };

    void take().catch(() => {});
    // Only what is sent to this window: each app has a window of its own.
    void import('@tauri-apps/api/webviewWindow')
      .then(({ getCurrentWebviewWindow }) => getCurrentWebviewWindow().listen('launch-request', () => void take().catch(() => {})))
      .then((unlisten) => {
        if (stopped) unlisten();
        else stopListening = unlisten;
        // What was handed over before this side listened is taken now.
        return take();
      })
      .catch(() => {});
    return () => {
      stopped = true;
      gatherer.stop();
      stopListening();
    };
  }, [ready]);
}
