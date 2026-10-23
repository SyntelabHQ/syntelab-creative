import type { AppHost } from '@syntelab/shell-api';
import { useState } from 'react';

/**
 * The options of a tool: read once from what the app kept (made valid by
 * `read`), and kept again at every change. They are settings, not something
 * typed into the tool: a secret, or anything else that must not reach the
 * disk, does not belong here.
 */
export function useOptions<T extends object>(host: Pick<AppHost, 'loadData' | 'saveData'>, key: string, read: (stored: unknown) => T): readonly [T, (changed: Partial<T>) => void] {
  const [options, setOptions] = useState(() => read(host.loadData<unknown>(key)));
  const change = (changed: Partial<T>) => {
    const next = { ...options, ...changed };
    setOptions(next);
    host.saveData(key, next);
  };
  return [options, change];
}

/** What was stored, as a record to read choices from; empty when it is no such thing. */
export function stored(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
