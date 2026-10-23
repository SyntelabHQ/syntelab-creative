import type { AppHost } from '@syntelab/shell-api';
import { toolById } from '../tools/catalog';

/** The tools a user pinned: they come first on the first page. Kept on this computer. */

const DATA_KEY = 'pins';

/** The pinned tools, in the order they were pinned. */
export function pinsOf(host: Pick<AppHost, 'loadData'>): readonly string[] {
  const stored = host.loadData<unknown>(DATA_KEY);
  // A tool that is no longer there is passed over.
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && toolById(id) !== undefined) : [];
}

export function savePins(host: Pick<AppHost, 'saveData'>, pins: readonly string[]): void {
  host.saveData(DATA_KEY, pins);
}
