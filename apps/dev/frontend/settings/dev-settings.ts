import { createDataStore, useDataStore } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';

/** The settings of Dev: they belong to this app only. Kept on this computer. */
export interface DevSettings {
  /** A tool chosen from the menus or the first page opens in the tab it is chosen in; else in a tab of its own. */
  readonly sameTab: boolean;
  /** What a new Dev tab opens on: the first page, or the tool that was used last. */
  readonly startOn: 'start' | 'last';
}

const DEFAULT_SETTINGS: DevSettings = { sameTab: true, startOn: 'start' };

/** Settings as stored, made whole: what is missing or not valid is as the program ships it. */
function readSettings(stored: unknown): DevSettings {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_SETTINGS;
  const { sameTab, startOn } = stored as Record<string, unknown>;
  return { sameTab: typeof sameTab === 'boolean' ? sameTab : DEFAULT_SETTINGS.sameTab, startOn: startOn === 'last' ? 'last' : 'start' };
}

const store = createDataStore('settings', readSettings);

/** Changes some settings, from what they are at that moment. */
export function changeSettings(host: Pick<AppHost, 'loadData' | 'saveData'>, change: Partial<DevSettings>): void {
  store.save(host, readSettings({ ...store.load(host), ...change }));
}

/** The key the tool that was used last is kept under: its name only, never anything that was in it. */
export const LAST_TOOL_KEY = 'lastTool';

/** The settings as they are now; whoever uses them is drawn again when they change. */
export function useDevSettings(host: Pick<AppHost, 'loadData'>): DevSettings {
  return useDataStore(store, host);
}
