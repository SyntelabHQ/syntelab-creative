import { useSyncExternalStore } from 'react';
import type { AppHost } from './app-frontend';

/**
 * Data an app keeps on this computer under one key (its settings, say): read
 * once, then shared by every tab and by the Settings page, so a change shows
 * everywhere at once.
 */
export interface DataStore<T> {
  /** The value, read from storage the first time it is asked for. */
  load(host: Pick<AppHost, 'loadData'>): T;
  /** Replaces the value, stores it and tells whoever watches it. */
  save(host: Pick<AppHost, 'saveData'>, value: T): void;
  subscribe(listener: () => void): () => void;
}

/**
 * `read` makes what is stored whole (what is missing or not valid is left at
 * its default); `toStore` is what is written, the value itself unless given.
 */
export function createDataStore<T>(key: string, read: (stored: unknown) => T, toStore: (value: T) => unknown = (value) => value): DataStore<T> {
  let current: T | null = null;
  const listeners = new Set<() => void>();
  return {
    load(host) {
      current ??= read(host.loadData<unknown>(key));
      return current;
    },
    save(host, value) {
      current = value;
      host.saveData(key, toStore(value));
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The value of a store, kept up to date while it is changed elsewhere. */
export function useDataStore<T>(store: DataStore<T>, host: Pick<AppHost, 'loadData'>): T {
  return useSyncExternalStore(store.subscribe, () => store.load(host));
}
