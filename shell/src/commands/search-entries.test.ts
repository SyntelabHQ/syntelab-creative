import type { AppManifest } from '@syntelab/shell-api';
import { describe, expect, it } from 'vitest';

// Every app's manifest and English texts, as the program ships them.
const manifests = import.meta.glob<AppManifest>('../../../apps/*/app.json', { import: 'default', eager: true });
const englishTexts = import.meta.glob<Record<string, string>>('../../../apps/*/locales/en.json', { import: 'default', eager: true });

const folderOf = (path: string) => /\/apps\/([^/]+)\//.exec(path)?.[1] ?? '';

describe('the search of the Start page', () => {
  it('finds the tools of every app that is out, each by a name it has', () => {
    const active = Object.entries(manifests).filter(([, manifest]) => manifest.status === 'active');
    expect(active.length).toBeGreaterThan(0);
    for (const [path, manifest] of active) {
      const entries = manifest.search ?? [];
      // An app that is out says what of it can be found: a new app is not left out of the search.
      expect(entries.length, `${manifest.id} has entries for the search`).toBeGreaterThan(0);
      const texts = englishTexts[`../../../apps/${folderOf(path)}/locales/en.json`] ?? {};
      for (const entry of entries) {
        expect(texts[entry.labelKey], `${manifest.id}: ${entry.labelKey} is translated`).toBeTypeOf('string');
        // Opened as a tab named after its first value: one tab for each entry.
        expect(Object.keys(entry.params ?? {}).length, `${manifest.id}: ${entry.id} opens with one value`).toBe(1);
      }
      expect(new Set(entries.map((entry) => entry.id)).size, `${manifest.id}: entries are told apart`).toBe(entries.length);
    }
  });
});
