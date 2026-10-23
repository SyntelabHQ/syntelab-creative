import { Suspense, useMemo } from 'react';
import { useImmersive } from '../immersive';
import type { Tab } from '../tabs';
import { appView } from './app-frontends';
import { AppPlaceholderView } from './app-placeholder-view';
import { createAppServices } from './create-app-host';

export interface AppTabViewProps {
  readonly tab: Tab;
  readonly active: boolean;
}

/** What an app tab shows: the app's own interface, given the shell's services. */
export function AppTabView({ tab, active }: AppTabViewProps) {
  const appId = tab.appId ?? '';
  // Not keyed on the tab object itself: that is replaced when its state (unsaved…) changes.
  const services = useMemo(() => createAppServices(appId, tab.id, tab.params), [appId, tab.id, tab.params]);
  const immersive = useImmersive();
  const host = useMemo(() => ({ ...services, active, immersive }), [services, active, immersive]);
  const View = appView(appId);

  if (!View) return <AppPlaceholderView appId={appId} />;
  return (
    <Suspense fallback={null}>
      <View host={host} />
    </Suspense>
  );
}
