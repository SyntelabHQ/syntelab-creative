import { useEffect } from 'react';
import { useApps, useAppTexts } from '../apps';
import { isTauri } from '../platform';
import { tabs } from '../tabs';

/** Names the window after its app, in the user's language. */
export function useWindowTitle(): void {
  const { apps } = useApps();
  const appTexts = useAppTexts();
  const app = apps.find((known) => known.manifest.id === tabs.homeApp);
  const title = app ? appTexts.name(app) : null;

  useEffect(() => {
    if (title === null) return;
    document.title = title;
    if (!isTauri()) return;
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title)).catch(() => {});
  }, [title]);
}
