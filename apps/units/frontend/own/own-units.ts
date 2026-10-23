import { createDataStore, useDataStore } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { useSyncExternalStore } from 'react';

/**
 * A unit of the user's own. It belongs to a converter and is said by another
 * unit of it: with a factor (and an offset where its scale starts elsewhere),
 * or with a formula each way. Kept on this computer, by converter.
 */
export interface OwnUnit {
  readonly id: string;
  readonly name: string;
  readonly symbol: string;
  /** The unit it is said by: one of the converter, or one of the user's own listed before it. */
  readonly reference: string;
  /** The usual way: `reference = value × factor + offset`. Written with a point before the decimals. */
  readonly factor?: string;
  readonly offset?: string;
  /** The advanced way: `reference = toReference(x)`, and `fromReference` its way back. */
  readonly toReference?: string;
  readonly fromReference?: string;
}

export type OwnUnits = Readonly<Record<string, readonly OwnUnit[]>>;

type Storage = Pick<AppHost, 'loadData' | 'saveData'>;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/** Units as stored or as read from a file, made whole: what is not a unit is left out. */
export function readOwnUnits(stored: unknown): OwnUnits {
  if (typeof stored !== 'object' || stored === null) return {};
  const all: Record<string, OwnUnit[]> = {};
  for (const [converter, listed] of Object.entries(stored)) {
    if (!Array.isArray(listed)) continue;
    const seen = new Set<string>();
    const units = listed.flatMap((entry: unknown): OwnUnit[] => {
      if (typeof entry !== 'object' || entry === null) return [];
      const fields = entry as Record<string, unknown>;
      const [id, name, symbol, reference] = [text(fields.id), text(fields.name), text(fields.symbol), text(fields.reference)];
      if (!id || !name || !symbol || !reference || seen.has(id)) return [];
      seen.add(id);
      const [factor, offset, toReference, fromReference] = [text(fields.factor), text(fields.offset), text(fields.toReference), text(fields.fromReference)];
      // One way of saying it: formulas, or a factor.
      return [toReference !== undefined ? { id, name, symbol, reference, toReference, fromReference: fromReference ?? '' } : { id, name, symbol, reference, factor: factor ?? '1', ...(offset !== undefined ? { offset } : {}) }];
    });
    if (units.length > 0) all[converter] = units;
  }
  return all;
}

const store = createDataStore('ownUnits', readOwnUnits);
/** Goes up with every change: what was read with the units of before is read again. */
let version = 0;

const allOwnUnits = (host: Pick<AppHost, 'loadData'>): OwnUnits => store.load(host);

export const ownUnitsOf = (host: Pick<AppHost, 'loadData'>, converterId: string): readonly OwnUnit[] => allOwnUnits(host)[converterId] ?? [];

export const ownUnitsVersion = (): number => version;

/** Replaces every unit of the user's own: after an import. */
export function saveAllOwnUnits(host: Storage, all: OwnUnits): void {
  version += 1;
  store.save(host, readOwnUnits(all));
}

/** Replaces the user's own units of one converter. */
export function saveOwnUnits(host: Storage, converterId: string, units: readonly OwnUnit[]): void {
  const { [converterId]: _before, ...others } = allOwnUnits(host);
  saveAllOwnUnits(host, units.length > 0 ? { ...others, [converterId]: units } : others);
}

/** Every unit of the user's own, kept up to date while they are changed elsewhere. */
export function useOwnUnits(host: Pick<AppHost, 'loadData'>): OwnUnits {
  return useDataStore(store, host);
}

/** Changes whenever a unit of the user's own does. */
export function useOwnUnitsVersion(): number {
  return useSyncExternalStore(store.subscribe, ownUnitsVersion);
}

/** An id no unit has: units of the program never start so. */
export function newOwnId(taken: readonly string[]): string {
  for (let at = 1; ; at++) {
    const id = `own-${Date.now().toString(36)}-${at}`;
    if (!taken.includes(id)) return id;
  }
}
