import { describe, expect, it, vi } from 'vitest';
import { createDataStore } from './data-store';

function storage(saved: Record<string, unknown> = {}) {
  const host = {
    saved,
    reads: 0,
    loadData: <T>(key: string) => {
      host.reads += 1;
      return saved[key] as T | undefined;
    },
    saveData: (key: string, value: unknown) => {
      saved[key] = value;
    },
  };
  return host;
}

const readCount = (stored: unknown) => (typeof stored === 'number' ? stored : 0);

describe('data store', () => {
  it('reads what is stored once, made whole', () => {
    const host = storage({ count: 'nonsense' });
    const store = createDataStore('count', readCount);
    expect(store.load(host)).toBe(0);
    host.saved.count = 5;
    expect(store.load(host)).toBe(0);
    expect(host.reads).toBe(1);
  });

  it('saves under its key, as given or as `toStore` makes it, and tells its watchers', () => {
    const host = storage();
    const store = createDataStore('count', readCount, (value) => ({ value }));
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.save(host, 3);
    expect(store.load(host)).toBe(3);
    expect(host.saved.count).toEqual({ value: 3 });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.save(host, 4);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(host.reads).toBe(0);
  });
});
