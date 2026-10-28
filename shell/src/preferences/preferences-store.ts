import { THEME_PREFERENCES } from '@syntelab/ui-kit';
import type { ThemePreference } from '@syntelab/ui-kit';
import { SYSTEM_LANGUAGE } from '../i18n';
import { createStore } from '../state/create-store';
import type { Store } from '../state/create-store';

/** When a tooltip shows: as soon as the pointer is on the control, after it has rested there a moment (as most programs do), or never. */
/** The narrowest and the widest the list of tools can be dragged with its names; narrower, it folds to its icons. */
export const TOOLS_NARROWEST = 150;
export const TOOLS_WIDEST = 360;

export const TOOLTIP_MODES = ['instant', 'delayed', 'off'] as const;
export type TooltipMode = (typeof TOOLTIP_MODES)[number];

/** How the list of apps draws them. */
export const APPS_VIEWS = ['cards', 'named-icons', 'icons'] as const;
export type AppsView = (typeof APPS_VIEWS)[number];

/** What marks the tabs of an app: the app's icon, or a small square in its color. */
export const TAB_MARKS = ['icon', 'square'] as const;
export type TabMark = (typeof TAB_MARKS)[number];

export interface Preferences {
  readonly theme: ThemePreference;
  /** A language code, or `SYSTEM_LANGUAGE`. */
  readonly language: string;
  readonly firstRunDone: boolean;
  /** Id of the newest changelog entry the user has seen, or null. */
  readonly changelogSeenId: string | null;
  /** The list of an app's tools on the side shows only their icons (☰, on the left of the bar on top). */
  readonly toolsCollapsed: boolean;
  /** How wide that list is with its names, in pixels (dragged by its edge). */
  readonly toolsWidth: number;
  readonly appsView: AppsView;
  /** App ids in the order the user arranged them; apps not listed come after. */
  readonly appOrder: readonly string[];
  /** Ids of the apps the user took off the list of apps. */
  readonly hiddenApps: readonly string[];
  /** Ids of the apps still to come that the user chose to see in the list of apps: they are left off unless chosen. */
  readonly shownComingApps: readonly string[];
  readonly tabMark: TabMark;
  /** When the small texts that say what a button does show, once the pointer rests on it. */
  readonly tooltips: TooltipMode;
  /** Keys the user chose for the program's own commands, by command id (`Mod+Tab`); an empty text takes a command's keys away. */
  readonly shortcuts: Readonly<Record<string, string>>;
  /** Look for a newer version and newer changelog when the program starts. */
  readonly onlineChecks: boolean;
  /** The newer version the user has already been told about, or null. */
  readonly updateNotifiedVersion: string | null;
  /** Pages of syntelab.com (`feedback`, `support`) opened straight away: the user chose not to be told about them first. */
  readonly siteNoticesOff: readonly string[];
}

const STORAGE_KEY = 'syntelab-creative.preferences';

const DEFAULTS: Preferences = {
  theme: 'auto',
  language: SYSTEM_LANGUAGE,
  firstRunDone: false,
  changelogSeenId: null,
  toolsCollapsed: false,
  toolsWidth: 200,
  appsView: 'cards',
  appOrder: [],
  hiddenApps: [],
  shownComingApps: [],
  tabMark: 'icon',
  tooltips: 'delayed',
  shortcuts: {},
  onlineChecks: true,
  updateNotifiedVersion: null,
  siteNoticesOff: [],
};

/** `value` when it is one of `allowed`, else `fallback`. */
function oneOf<T extends string, F>(allowed: readonly T[], value: unknown, fallback: F): T | F {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** The strings of a stored list; anything else in it is dropped. */
function strings(stored: unknown): string[] {
  return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
}

function read(): Preferences {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return DEFAULTS;
    const values = stored as Record<string, unknown>;
    return {
      theme: oneOf(THEME_PREFERENCES, values.theme, DEFAULTS.theme),
      language: typeof values.language === 'string' ? values.language : DEFAULTS.language,
      firstRunDone: values.firstRunDone === true,
      changelogSeenId: typeof values.changelogSeenId === 'string' ? values.changelogSeenId : null,
      toolsCollapsed: values.toolsCollapsed === true,
      toolsWidth: typeof values.toolsWidth === 'number' && Number.isFinite(values.toolsWidth) ? Math.min(Math.max(Math.round(values.toolsWidth), TOOLS_NARROWEST), TOOLS_WIDEST) : DEFAULTS.toolsWidth,
      appsView: oneOf(APPS_VIEWS, values.appsView, DEFAULTS.appsView),
      appOrder: strings(values.appOrder),
      hiddenApps: strings(values.hiddenApps),
      shownComingApps: strings(values.shownComingApps),
      tabMark: oneOf(TAB_MARKS, values.tabMark, DEFAULTS.tabMark),
      // Kept from when the choice was only on or off.
      tooltips: values.tooltips === false ? 'off' : oneOf(TOOLTIP_MODES, values.tooltips, DEFAULTS.tooltips),
      shortcuts: Object.fromEntries(Object.entries(typeof values.shortcuts === 'object' && values.shortcuts !== null ? values.shortcuts : {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      onlineChecks: values.onlineChecks !== false,
      updateNotifiedVersion: typeof values.updateNotifiedVersion === 'string' ? values.updateNotifiedVersion : null,
      siteNoticesOff: strings(values.siteNoticesOff),
    };
  } catch {
    return DEFAULTS;
  }
}

function write(preferences: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be unavailable; the choice then lasts for this run only.
  }
}

function createPreferencesStore(): Store<Preferences> {
  const store = createStore(read());
  let fromOtherWindow = false;
  store.subscribe(() => {
    if (!fromOtherWindow) write(store.get());
  });
  // Each app has a window of its own: a choice made in one (the theme, the language) counts in the others at once.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY) return;
      fromOtherWindow = true;
      try {
        store.set(read());
      } finally {
        fromOtherWindow = false;
      }
    });
  }
  return store;
}

export const preferences = createPreferencesStore();

export function updatePreferences(change: Partial<Preferences>): void {
  preferences.set((current) => ({ ...current, ...change }));
}
