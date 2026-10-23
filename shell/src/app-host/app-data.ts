/** Where an app's own small data is kept: one entry per app and key. */
const storageKey = (appId: string, key: string) => `syntelab-creative.app.${appId}.${key}`;

/** Reads what the app saved under `key`; undefined when nothing (readable) is there. */
export function loadAppData<T>(appId: string, key: string): T | undefined {
  try {
    const stored = localStorage.getItem(storageKey(appId, key));
    return stored === null ? undefined : (JSON.parse(stored) as T);
  } catch {
    return undefined;
  }
}

export function saveAppData(appId: string, key: string, value: unknown): void {
  try {
    localStorage.setItem(storageKey(appId, key), JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the data then lasts for this run only.
  }
}
