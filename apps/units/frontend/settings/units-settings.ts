import { createDataStore, useDataStore } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import type { Extremes } from '../engine/units-api';
import type { Thousands } from '../format/local-number';

/** How narrow and how wide the units panel can be dragged. */
const NARROWEST_PANEL = 220;
const WIDEST_PANEL = 520;

/** The settings of Units: they belong to this app only. Kept on this computer. */
export interface UnitsSettings {
  /** A converter chosen from the menus opens in the tab it is chosen in; else in a tab of its own. */
  readonly sameTab: boolean;
  /** The table shows the number of each row. */
  readonly rowNumbers: boolean;
  /** How values too large or too small to read at a glance are written. */
  readonly extremes: Extremes;
  /** What is written between thousands: `10000.000` (nothing, as the program ships), `10 000.000` or `10,000.000`. */
  readonly between: Thousands;
  /** The units panel beside the table is unfolded, and how wide it is. */
  readonly panelShown: boolean;
  readonly panelWidth: number;
  /** What the head of a column says: the name and the symbol, the name, or the symbol. */
  readonly headFormat: HeadFormat;
  /** What is copied and exported starts with the titles of the columns, and each row with its number. */
  readonly withTitles: boolean;
  readonly withRowNumbers: boolean;
  /** Decimals the user chose for a unit, by converter: they stand over the unit's own, everywhere it is written. */
  readonly precision: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** The units the table of a converter starts with, where the user chose them. */
  readonly startsWith: Readonly<Record<string, readonly string[]>>;
  /** In the units panel: the units of the table are folded away; so are the search and the filters. */
  readonly activeFolded: boolean;
  readonly addingFolded: boolean;
  /** The currency converter reads its rates from the network; else it uses the last it kept. */
  readonly ratesOnline: boolean;
  /** The two services the rates come from are named beside the rates. Their own words and addresses are in the manual. */
  readonly ratesCredit: boolean;
}

export type HeadFormat = 'both' | 'name' | 'symbol';

export const DEFAULT_SETTINGS: UnitsSettings = { sameTab: true, rowNumbers: true, extremes: 'scientific', between: 'none', panelShown: true, panelWidth: 300, headFormat: 'both', withTitles: true, withRowNumbers: false, precision: {}, startsWith: {}, ratesOnline: true, ratesCredit: true, activeFolded: false, addingFolded: false };

/** The most decimals a unit can be asked for. */
const MOST_DECIMALS = 30;

function decimalsByUnit(stored: unknown): UnitsSettings['precision'] {
  if (typeof stored !== 'object' || stored === null) return {};
  const all: Record<string, Record<string, number>> = {};
  for (const [converter, units] of Object.entries(stored)) {
    if (typeof units !== 'object' || units === null) continue;
    const kept = Object.fromEntries(Object.entries(units).filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && (entry[1] as number) >= 0 && (entry[1] as number) <= MOST_DECIMALS));
    if (Object.keys(kept).length > 0) all[converter] = kept;
  }
  return all;
}

function unitsByConverter(stored: unknown): UnitsSettings['startsWith'] {
  if (typeof stored !== 'object' || stored === null) return {};
  const all: Record<string, string[]> = {};
  for (const [converter, units] of Object.entries(stored)) {
    const kept = Array.isArray(units) ? units.filter((unit): unit is string => typeof unit === 'string') : [];
    if (kept.length > 0) all[converter] = [...new Set(kept)];
  }
  return all;
}

/** Settings as stored, made whole: what is missing or not valid (any more) is as the program ships it. */
function readSettings(stored: unknown): UnitsSettings {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_SETTINGS;
  const values = stored as Record<string, unknown>;
  const flag = (key: 'sameTab' | 'rowNumbers' | 'panelShown' | 'withTitles' | 'withRowNumbers' | 'ratesOnline' | 'ratesCredit' | 'activeFolded' | 'addingFolded') => (typeof values[key] === 'boolean' ? (values[key] as boolean) : DEFAULT_SETTINGS[key]);
  return {
    sameTab: flag('sameTab'),
    rowNumbers: flag('rowNumbers'),
    panelShown: flag('panelShown'),
    withTitles: flag('withTitles'),
    withRowNumbers: flag('withRowNumbers'),
    ratesOnline: flag('ratesOnline'),
    ratesCredit: flag('ratesCredit'),
    activeFolded: flag('activeFolded'),
    addingFolded: flag('addingFolded'),
    headFormat: values.headFormat === 'name' || values.headFormat === 'symbol' ? values.headFormat : 'both',
    extremes: values.extremes === 'full' ? 'full' : 'scientific',
    between: values.between === 'comma' || values.between === 'space' ? values.between : 'none',
    precision: decimalsByUnit(values.precision),
    startsWith: unitsByConverter(values.startsWith),
    panelWidth: typeof values.panelWidth === 'number' && Number.isFinite(values.panelWidth) ? Math.min(Math.max(Math.round(values.panelWidth), NARROWEST_PANEL), WIDEST_PANEL) : DEFAULT_SETTINGS.panelWidth,
  };
}

const store = createDataStore('settings', readSettings);

export function loadSettings(host: Pick<AppHost, 'loadData'>): UnitsSettings {
  return store.load(host);
}

/** Changes some settings, from what they are at that moment. */
export function changeSettings(host: Pick<AppHost, 'loadData' | 'saveData'>, change: Partial<UnitsSettings>): void {
  store.save(host, readSettings({ ...store.load(host), ...change }));
}

/** The settings, kept up to date while they are changed elsewhere. */
export function useUnitsSettings(host: Pick<AppHost, 'loadData'>): UnitsSettings {
  return useDataStore(store, host);
}
