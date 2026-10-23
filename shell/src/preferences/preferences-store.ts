import { THEME_PREFERENCES } from '@syntelab/ui-kit';
import type { ThemePreference } from '@syntelab/ui-kit';
import { SYSTEM_LANGUAGE } from '../i18n';
import { createStore } from '../state/create-store';
import type { Store } from '../state/create-store';

/** How an app's commands are laid out around it (CONCEPT.md, section 4.3). */
export const LAYOUTS = ['classic', 'ribbon', 'side-panel'] as const;
export type Layout = (typeof LAYOUTS)[number];

export const PANEL_SIDES = ['left', 'right'] as const;
export type PanelSide = (typeof PANEL_SIDES)[number];

/** How the ribbon shows its commands; see the ribbon. */
export const RIBBON_MODES = ['full', 'compact', 'hover'] as const;
export type RibbonMode = (typeof RIBBON_MODES)[number];

/** What the user chose for one app. Anything left out follows the app's default. */
/** When a tooltip shows: as soon as the pointer is on the control, after it has rested there a moment (as most programs do), or never. */
export const TOOLTIP_MODES = ['instant', 'delayed', 'off'] as const;
export type TooltipMode = (typeof TOOLTIP_MODES)[number];

export interface AppLayoutChoice {
  readonly layout?: Layout;
  /** Where the side panel layout puts its panel. */
  readonly panelSide?: PanelSide;
  /** The form the ribbon layout takes: large buttons, icons only, or shown on hover. */
  readonly ribbonMode?: RibbonMode;
}

/** How the start screen draws the apps. */
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
  /** The layout of the whole suite: what every app follows unless it has a choice of its own. */
  readonly globalLayout: AppLayoutChoice;
  /** The layout chosen for one app only, by app id: it overrides the suite's. */
  readonly appLayouts: Readonly<Record<string, AppLayoutChoice>>;
  /** The side panel is folded down to its smallest form. */
  readonly toolsCollapsed: boolean;
  readonly appsView: AppsView;
  /** App ids in the order the user arranged them; apps not listed come after. */
  readonly appOrder: readonly string[];
  /** Ids of the apps the user took off the Start screen and the app bar. */
  readonly hiddenApps: readonly string[];
  /** Ids of the apps still to come that the user chose to see on the Start screen: they are left off unless chosen. */
  readonly shownComingApps: readonly string[];
  /** Sections of the side panel the user folded, by the key of their menu. */
  readonly panelFoldedSections: readonly string[];
  /** The Start tab stays among the tabs while an app is in front; off, it shows only while Start itself is. */
  readonly startTabAlways: boolean;
  readonly tabMark: TabMark;
  /** When the small texts that say what a button does show, once the pointer rests on it. */
  readonly tooltips: TooltipMode;
  /** Keys the user chose for the program's own commands, by command id (`Mod+Tab`); an empty text takes a command's keys away. */
  readonly shortcuts: Readonly<Record<string, string>>;
  /** Look for a newer version and newer changelog when the program starts. */
  readonly onlineChecks: boolean;
  /** The newer version the user has already been told about, or null. */
  readonly updateNotifiedVersion: string | null;
}

const STORAGE_KEY = 'syntelab-creative.preferences';

const DEFAULTS: Preferences = {
  theme: 'auto',
  language: SYSTEM_LANGUAGE,
  firstRunDone: false,
  changelogSeenId: null,
  globalLayout: {},
  appLayouts: {},
  toolsCollapsed: false,
  appsView: 'cards',
  appOrder: [],
  hiddenApps: [],
  shownComingApps: [],
  panelFoldedSections: [],
  startTabAlways: false,
  tabMark: 'icon',
  tooltips: 'delayed',
  shortcuts: {},
  onlineChecks: true,
  updateNotifiedVersion: null,
};

/** `value` when it is one of `allowed`, else `fallback`. */
function oneOf<T extends string, F>(allowed: readonly T[], value: unknown, fallback: F): T | F {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** The strings of a stored list; anything else in it is dropped. */
function strings(stored: unknown): string[] {
  return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
}

function readLayoutChoice(stored: unknown): AppLayoutChoice {
  if (typeof stored !== 'object' || stored === null) return {};
  const { layout, panelSide, ribbonMode } = stored as Record<string, unknown>;
  return {
    layout: oneOf(LAYOUTS, layout, undefined),
    panelSide: oneOf(PANEL_SIDES, panelSide, undefined),
    ribbonMode: oneOf(RIBBON_MODES, ribbonMode, undefined),
  };
}

function readAppLayouts(stored: unknown): Record<string, AppLayoutChoice> {
  if (typeof stored !== 'object' || stored === null) return {};
  const layouts: Record<string, AppLayoutChoice> = {};
  for (const [appId, choice] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof choice === 'object' && choice !== null) layouts[appId] = readLayoutChoice(choice);
  }
  return layouts;
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
      globalLayout: readLayoutChoice(values.globalLayout),
      appLayouts: readAppLayouts(values.appLayouts),
      toolsCollapsed: values.toolsCollapsed === true,
      appsView: oneOf(APPS_VIEWS, values.appsView, DEFAULTS.appsView),
      appOrder: strings(values.appOrder),
      hiddenApps: strings(values.hiddenApps),
      shownComingApps: strings(values.shownComingApps),
      panelFoldedSections: strings(values.panelFoldedSections),
      startTabAlways: values.startTabAlways === true,
      tabMark: oneOf(TAB_MARKS, values.tabMark, DEFAULTS.tabMark),
      // Kept from when the choice was only on or off.
      tooltips: values.tooltips === false ? 'off' : oneOf(TOOLTIP_MODES, values.tooltips, DEFAULTS.tooltips),
      shortcuts: Object.fromEntries(Object.entries(typeof values.shortcuts === 'object' && values.shortcuts !== null ? values.shortcuts : {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      onlineChecks: values.onlineChecks !== false,
      updateNotifiedVersion: typeof values.updateNotifiedVersion === 'string' ? values.updateNotifiedVersion : null,
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
  store.subscribe(() => write(store.get()));
  return store;
}

export const preferences = createPreferencesStore();

export function updatePreferences(change: Partial<Preferences>): void {
  preferences.set((current) => ({ ...current, ...change }));
}

export interface ResolvedAppLayout {
  readonly layout: Layout;
  readonly panelSide: PanelSide;
  readonly ribbonMode: RibbonMode;
}

/**
 * The layout an app is shown in: what the user chose for that app, else what
 * they chose for the whole suite, else the default the app declares in
 * `app.json` (`defaultLayout`), else the ribbon.
 */
export function resolveAppLayout(
  appLayouts: Preferences['appLayouts'],
  appId: string,
  appDefault: string | undefined,
  globalLayout: AppLayoutChoice = {},
): ResolvedAppLayout {
  const choice = appLayouts[appId];
  return {
    layout: choice?.layout ?? globalLayout.layout ?? oneOf(LAYOUTS, appDefault, 'ribbon'),
    panelSide: choice?.panelSide ?? globalLayout.panelSide ?? 'left',
    ribbonMode: choice?.ribbonMode ?? globalLayout.ribbonMode ?? 'full',
  };
}

/** Remembers a layout choice for the whole suite. */
export function setGlobalLayout(change: AppLayoutChoice): void {
  preferences.set((current) => ({ ...current, globalLayout: { ...current.globalLayout, ...change } }));
}

/** Forgets the layout chosen for one app: it follows the suite again. */
export function clearAppLayout(appId: string): void {
  preferences.set((current) => {
    const { [appId]: _forgotten, ...rest } = current.appLayouts;
    return { ...current, appLayouts: rest };
  });
}

/** Remembers a layout choice for one app only. */
export function setAppLayout(appId: string, change: AppLayoutChoice): void {
  preferences.set((current) => ({
    ...current,
    appLayouts: { ...current.appLayouts, [appId]: { ...current.appLayouts[appId], ...change } },
  }));
}
