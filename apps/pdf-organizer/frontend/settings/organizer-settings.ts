import { createDataStore, useDataStore } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { SHEET_NAMES } from '../document/sheets';
import { DEFAULT_BINDER_THUMBNAIL_SIZE, DEFAULT_ORGANIZE_THUMBNAIL_SIZE, snapThumbnailSize } from '../organize/thumbnail-size';

/** How large a document is shown when it opens. */
export const OPEN_ZOOMS = ['fit-page', 'fit-width', 'fit-height', 'actual'] as const;
export type OpenZoom = (typeof OPEN_ZOOMS)[number];

/** The units lengths are shown and typed in: on the rulers, in the windows that ask for sizes. */
export const MEASURE_UNITS = ['mm', 'in', 'pt'] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

/** The paper the print window starts with; `printer` leaves it to the printer. */
export const PRINTER_SHEET = 'printer';
const PRINT_SHEETS: readonly string[] = [...SHEET_NAMES, PRINTER_SHEET];
/** The name of a standard sheet (see `sheets.ts`), or `PRINTER_SHEET`. */
export type PrintSheet = string;
/** How sheets lie: `auto` turns the sheet sideways for wide pages. */
export const PRINT_ORIENTATIONS = ['auto', 'portrait', 'landscape'] as const;
export type PrintOrientation = (typeof PRINT_ORIENTATIONS)[number];
/** Pages made to fit the sheet, or printed at their real size. */
export const PRINT_SCALINGS = ['fit', 'actual'] as const;
export type PrintScaling = (typeof PRINT_SCALINGS)[number];

/** What the quick toolbar (the strip above the pages) can show, in the order it shows them. */
export const QUICK_TOOLS = ['save', 'print', 'history', 'pages', 'zoom', 'fit', 'rotate', 'find', 'organize', 'share'] as const;
export type QuickTool = (typeof QUICK_TOOLS)[number];

/** DigiCert's time-stamping authority: free, without an account, and trusted by Adobe and Windows. */
const DEFAULT_TIME_STAMP_SERVER = 'http://timestamp.digicert.com';

/** True for an address a time-stamping authority can be at (the Rust side checks it again). */
export function isTimeStampServer(address: string): boolean {
  try {
    const url = new URL(address.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/**
 * The settings of PDF Organizer: they belong to this app only, apart from
 * the settings of the whole suite. Kept on this computer.
 */
export interface OrganizerSettings {
  readonly openZoom: OpenZoom;
  /** True: a document opens as one long strip of pages. False: one page at a time. */
  readonly openScrolling: boolean;
  /** The small pages on the side are shown when a document opens. */
  readonly openThumbnails: boolean;
  readonly quickTools: readonly QuickTool[];
  readonly unit: MeasureUnit;
  /** Rulers and the grid are shown when a document opens. */
  readonly showRulers: boolean;
  readonly showGrid: boolean;
  /** From one line of the grid to the next, in points. */
  readonly gridSpacing: number;
  readonly printSheet: PrintSheet;
  readonly printOrientation: PrintOrientation;
  readonly printScaling: PrintScaling;
  /** Keys the user chose for commands, by command id (`Mod+S`); an empty text takes a command's keys away. */
  readonly shortcuts: Readonly<Record<string, string>>;
  /** Name of a document made of pages taken out of another. `{name}` is that document's name. */
  readonly extractName: string;
  /** Name of each document when every page is taken out on its own. `{number}` counts them. */
  readonly extractEachName: string;
  /** Name of a document made new (files combined, a picture turned into a PDF). `{number}` counts up. */
  readonly newName: string;
  /** Name of the one PDF that batch processing gathers many files in, unless another is typed there. */
  readonly combinedName: string;
  /** The tools for drawing are shown as a list with their names instead of a grid of buttons. */
  readonly toolsAsList: boolean;
  /** Who attaches files, as last typed: filled in for the next file. */
  readonly attachAuthor: string;
  /** Before "Save" writes a changed document over a file that is signed with a certificate, the user is asked: its signatures go. */
  readonly warnSignedSave: boolean;
  /** Before the area of a signature with a certificate is dragged on the page, a window says what comes next. */
  readonly signAreaHint: boolean;
  /** Signatures with a certificate get a time stamp: an authority confirms when they were made. */
  readonly timeStampSignatures: boolean;
  /** The address of the time-stamping authority (RFC 3161) asked for time stamps. */
  readonly timeStampServer: string;
  /** How large the pages of the Organize grid are shown: the longest side, in pixels. */
  readonly organizeThumbnailSize: number;
  /** How large the first page of each file on a binder's cards is shown: the longest side, in pixels. */
  readonly binderThumbnailSize: number;
}

export const DEFAULT_SETTINGS: OrganizerSettings = {
  openZoom: 'fit-page',
  openScrolling: false,
  openThumbnails: true,
  quickTools: ['pages', 'zoom', 'share'],
  unit: 'mm',
  showRulers: false,
  showGrid: false,
  // 10 mm.
  gridSpacing: (72 / 25.4) * 10,
  printSheet: 'a4',
  printOrientation: 'auto',
  printScaling: 'fit',
  shortcuts: {},
  extractName: 'pages_of_{name}',
  extractEachName: 'page{number}_of_{name}',
  newName: 'syntelab_pdf_{number}',
  combinedName: 'syntelab-combined',
  toolsAsList: false,
  attachAuthor: '',
  warnSignedSave: true,
  signAreaHint: true,
  timeStampSignatures: true,
  timeStampServer: DEFAULT_TIME_STAMP_SERVER,
  organizeThumbnailSize: DEFAULT_ORGANIZE_THUMBNAIL_SIZE,
  binderThumbnailSize: DEFAULT_BINDER_THUMBNAIL_SIZE,
};

export type SettingKey = keyof OrganizerSettings;
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

/** True when the setting is as the program ships it. */
export function isDefault(settings: OrganizerSettings, key: SettingKey): boolean {
  return JSON.stringify(settings[key]) === JSON.stringify(DEFAULT_SETTINGS[key]);
}

/** The settings that are one of a few choices, with those choices. */
const CHOICES: Partial<Record<SettingKey, readonly unknown[]>> = {
  openZoom: OPEN_ZOOMS,
  unit: MEASURE_UNITS,
  printSheet: PRINT_SHEETS,
  printOrientation: PRINT_ORIENTATIONS,
  printScaling: PRINT_SCALINGS,
};

/** One setting read from storage; the default when what is stored is not valid (any more). */
function readSetting<K extends SettingKey>(key: K, stored: unknown): OrganizerSettings[K] {
  const fallback = DEFAULT_SETTINGS[key];
  if (stored === undefined) return fallback;
  let value: unknown = fallback;
  const choices = CHOICES[key];
  if (choices) value = choices.includes(stored) ? stored : fallback;
  else if (key === 'timeStampServer') value = typeof stored === 'string' && isTimeStampServer(stored) ? stored.trim() : fallback;
  else if (key === 'gridSpacing') value = typeof stored === 'number' && stored >= 2 && stored <= 720 ? stored : fallback;
  else if (key === 'organizeThumbnailSize' || key === 'binderThumbnailSize') value = snapThumbnailSize(stored, fallback as number);
  else if (key === 'shortcuts') {
    const chosen = typeof stored === 'object' && stored !== null ? Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string') : [];
    value = Object.fromEntries(chosen);
  } else if (key === 'quickTools') {
    // Kept in the toolbar's own order, whatever order they were stored in.
    value = Array.isArray(stored) ? QUICK_TOOLS.filter((tool) => stored.includes(tool)) : fallback;
  } else if (typeof stored === typeof fallback) value = stored;
  return value as OrganizerSettings[K];
}

/** Settings as stored (only what differs from the defaults is), made whole. */
export function readSettings(stored: unknown): OrganizerSettings {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_SETTINGS;
  const values = stored as Record<string, unknown>;
  const settings: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) settings[key] = readSetting(key, values[key]);
  return settings as unknown as OrganizerSettings;
}

/** What to store: the settings that differ from the defaults; the rest keep following the defaults. */
export function settingsToStore(settings: OrganizerSettings): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) if (!isDefault(settings, key)) changed[key] = settings[key];
  return changed;
}

const store = createDataStore('settings', readSettings, settingsToStore);

export function loadSettings(host: Pick<AppHost, 'loadData'>): OrganizerSettings {
  return store.load(host);
}

export function saveSettings(host: Pick<AppHost, 'loadData' | 'saveData'>, settings: OrganizerSettings): void {
  store.save(host, settings);
}

/** The settings, kept up to date while they are changed elsewhere. */
export function useOrganizerSettings(host: Pick<AppHost, 'loadData'>): OrganizerSettings {
  return useDataStore(store, host);
}
