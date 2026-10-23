import type { AppFrontend, AppSettingsProps, AppViewProps } from '@syntelab/shell-api';
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

// Every app that has an interface exports it from apps/<app-id>/frontend/index.ts.
// Each is loaded only when one of its tabs is first shown.
const entries = import.meta.glob<AppFrontend>('../../../apps/*/frontend/index.{ts,tsx}', {
  import: 'default',
});

type AppView = LazyExoticComponent<ComponentType<AppViewProps>>;

type AppSettingsView = LazyExoticComponent<ComponentType<AppSettingsProps>>;

/** Shown for an app that offers no settings of its own. */
const NoSettings = () => null;

const views = new Map<string, AppView>();
const settingsViews = new Map<string, AppSettingsView>();
for (const [path, load] of Object.entries(entries)) {
  const appId = /\/apps\/([^/]+)\/frontend\//.exec(path)?.[1];
  if (!appId) continue;
  views.set(appId, lazy(async () => ({ default: (await load()).View })));
  settingsViews.set(appId, lazy(async () => ({ default: (await load()).Settings ?? NoSettings })));
}

/** The app's interface, or undefined when the app has none yet. */
export function appView(appId: string): AppView | undefined {
  return views.get(appId);
}

/** The app's own part of Settings (empty when it offers none), or undefined when the app has no interface yet. */
export function appSettingsView(appId: string): AppSettingsView | undefined {
  return settingsViews.get(appId);
}
