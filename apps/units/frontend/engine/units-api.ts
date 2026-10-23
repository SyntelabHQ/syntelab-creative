import type { AppHost } from '@syntelab/shell-api';
import { ownUnitsOf, ownUnitsVersion } from '../own/own-units';
import type { OwnUnit } from '../own/own-units';
import { CURRENCY, ratesAreDue, ratesVersion, refreshRates } from '../rates/rates-store';

/** A converter as the menus list it. */
export interface ConverterEntry {
  readonly id: string;
  /** One of the six categories the converters are listed under. */
  readonly category: string;
  /** Name of a file in `assets/icons/`, without the extension. */
  readonly icon: string;
  readonly units: number;
}

export interface UnitGroup {
  readonly id: string;
  /** The colour its units are marked with, as `#rrggbb`. */
  readonly color: string;
}

export interface UnitInfo {
  readonly id: string;
  readonly symbol: string;
  readonly group: string;
  readonly popular: boolean;
  /** Decimals a value in this unit is written with, unless the user asks for others. */
  readonly decimals: number;
  /** Its value is measured, not defined. */
  readonly measured: boolean;
  /** Other things it is called and written as, for the search. */
  readonly aliases: readonly string[];
  /** Its values are text (base 16, Roman numerals): shown as they are, with no decimals. */
  readonly text?: boolean;
  /** For a currency: of a country (`fiat`) or a cryptocurrency (`crypto`). Null for every other unit. */
  readonly currency?: 'fiat' | 'crypto' | null;
  /** The name the user gave it, for a unit of the user's own; null for the others, which the translations name. */
  readonly name?: string | null;
}

export interface ConverterInfo {
  readonly id: string;
  readonly category: string;
  readonly icon: string;
  readonly base: string;
  /** The units a table of this converter starts with. */
  readonly startsWith: readonly string[];
  readonly groups: readonly UnitGroup[];
  readonly units: readonly UnitInfo[];
  /** Units of the user's own that could not be taken (a formula that no longer reads, a unit it was said by that is gone). */
  readonly refused?: readonly string[];
}

/** What the Rust side says of the user's own units of a converter when it tries them. */
export type OwnCheck =
  | {
      readonly ok: true;
      readonly base: string;
      /** Of each unit: one of it in the base unit of the converter (null when it has no value there), and whether its formulas undo each other (null without formulas). */
      readonly units: readonly { readonly id: string; readonly one: string | null; readonly undoesItself: boolean | null }[];
    }
  | { readonly ok: false; readonly unit: string; readonly what: string; readonly at: number | null };

/** Tries units of the user's own without keeping them. */
export const checkOwnUnits = (host: Invoker, converter: string, units: readonly OwnUnit[]) => host.invoke<OwnCheck>('own_units', { converter, units, check: true });

/** Gives the Rust side the user's own units of a converter. Those it refuses are left out, and named. */
async function sendOwnUnits(host: Invoker, converter: string, units: readonly OwnUnit[]): Promise<string[]> {
  const refused: string[] = [];
  let sent = [...units];
  for (;;) {
    const answer = await host.invoke<OwnCheck>('own_units', { converter, units: sent });
    if (answer.ok) return refused;
    const wrong = answer.unit;
    // A unit said by one that was refused goes with it, at the next turn.
    const left = sent.filter((unit) => unit.id !== wrong);
    if (left.length === sent.length) return [...refused, ...sent.map((unit) => unit.id)];
    refused.push(wrong);
    sent = left;
  }
}

/** A value in one unit: its digits with a point before the decimals and nothing between thousands, or with a power of ten (`1.6e-35`). */
export interface ConvertedValue {
  readonly unit: string;
  readonly text: string;
  readonly measured: boolean;
}

export interface Converted {
  /** Nothing was typed. */
  readonly empty: boolean;
  /** What was typed could be read two ways; the language of the program decided. */
  readonly ambiguous?: boolean;
  readonly results: readonly ConvertedValue[];
}

/** How values too large or too small to read at a glance are written. */
export type Extremes = 'scientific' | 'full';

export interface ConvertRequest {
  readonly converter: string;
  /** The unit the value is in. */
  readonly from: string;
  /** The value as it was typed. */
  readonly value: string;
  readonly to: readonly string[];
  /** Decimals asked for, by unit, over those of the units themselves. */
  readonly decimals?: Readonly<Record<string, number>>;
  readonly extremes?: Extremes;
  /** The mark the language of the program writes before decimals. */
  readonly decimalMark: string;
}

type Invoker = Pick<AppHost, 'invoke'>;

/** Converters the menus list that are not built yet: shown, and waiting. None now. */
export const COMING: readonly ConverterEntry[] = [];

/** The six categories, in the order of the menus. */
export const CATEGORIES = ['essentials', 'motion', 'energy', 'scientific', 'digital', 'physics'] as const;

export async function listConverters(host: Invoker): Promise<readonly ConverterEntry[]> {
  return (await host.invoke<{ converters: ConverterEntry[] }>('converters', {})).converters;
}

const loaded = new Map<string, { readonly version: number; readonly info: Promise<ConverterInfo> }>();
/**
 * A converter with its units, the user's own among them. Read once, and again
 * when the user's own units change: the units of the program do not change
 * while it runs.
 */
export function loadConverter(host: Pick<AppHost, 'invoke' | 'loadData' | 'saveData'>, id: string): Promise<ConverterInfo> {
  const version = ownUnitsVersion();
  const known = loaded.get(id);
  if (known && known.version === version) return known.info;
  // Currencies are worth what their rates say: read first, when there are none or they are due. Without a
  // connection the converter still opens, with the last rates that were kept, or with none.
  const rates = id === CURRENCY && ratesAreDue() ? refreshRates(host).catch(() => {}) : Promise.resolve();
  // The Rust side learns the user's own units first: they are kept here, and it starts without them.
  const info = rates.then(() => sendOwnUnits(host, id, ownUnitsOf(host, id))).then(async (refused) => ({ ...(await host.invoke<ConverterInfo>('converter', { id })), refused }));
  loaded.set(id, { version, info });
  // One that could not be read is asked for again next time.
  info.catch(() => loaded.get(id)?.info === info && loaded.delete(id));
  return info;
}

/** Goes up whenever what a conversion comes to may have changed without its units changing: the rates of currencies. */
export { ratesVersion };

export function convert(host: Invoker, request: ConvertRequest): Promise<Converted> {
  return host.invoke<Converted>('convert', request);
}
