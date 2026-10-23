import type { AppHost } from '@syntelab/shell-api';
import type { ConverterInfo } from '../engine/units-api';

/**
 * The units a user pinned, by converter: their favourites. Pinned units come
 * first wherever units are listed: in the smart converter and in the units
 * panel of the table. Kept on this computer.
 */

const DATA_KEY = 'pins';
type Storage = Pick<AppHost, 'loadData' | 'saveData'>;

function stored(host: Pick<AppHost, 'loadData'>): Readonly<Record<string, readonly string[]>> {
  const value = host.loadData<unknown>(DATA_KEY);
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((id) => typeof id === 'string')));
}

/** The pinned units of a converter, in the order they were pinned. None before the user pins one. */
export function pinsOf(host: Pick<AppHost, 'loadData'>, converter: ConverterInfo): readonly string[] {
  const chosen = stored(host)[converter.id];
  // Units that are no longer there (a custom unit taken out) are passed over.
  if (chosen) return chosen.filter((id) => converter.units.some((unit) => unit.id === id));
  return [];
}

export function savePins(host: Storage, converterId: string, pins: readonly string[]): void {
  host.saveData(DATA_KEY, { ...stored(host), [converterId]: pins });
}
