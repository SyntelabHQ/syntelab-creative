import type { AppEntry } from '@syntelab/shell-api';
import { describe, expect, it, vi } from 'vitest';
import { mergedRequests, requestGatherer, tabsFor } from './launch-requests';

const app = (id: string, status: 'active' | 'coming-soon', fileTypes: string[], entries: string[] = []): AppEntry => ({
  manifest: {
    id,
    version: '0',
    apiVersion: 1,
    status,
    name: { en: id },
    description: { en: id },
    brand: { color: '#000000', icon: 'icon.svg' },
    fileTypes,
    contextMenu: entries.map((entry) => ({ id: entry, labelKey: `${id}.${entry}` })),
  },
  iconSvg: null,
});
const apps = [app('pdf-organizer', 'active', ['.pdf'], ['combine-to-pdf']), app('convert', 'coming-soon', ['.png'], ['convert-to'])];

describe('what the program is started with', () => {
  it('takes an entry chosen on several files as one thing to do', () => {
    const one = (file: string) => ({ app: 'pdf-organizer', action: 'combine-to-pdf', files: [file] });
    const merged = mergedRequests([one('C:\\a.pdf'), { app: null, action: null, files: ['C:\\x.pdf'] }, one('C:\\b.pdf'), one('C:\\a.pdf')]);
    expect(merged).toEqual([
      { app: 'pdf-organizer', action: 'combine-to-pdf', files: ['C:\\a.pdf', 'C:\\b.pdf'] },
      { app: null, action: null, files: ['C:\\x.pdf'] },
    ]);
  });

  it('opens one tab of the app for an entry of the menu', () => {
    const tabs = tabsFor({ app: 'pdf-organizer', action: 'combine-to-pdf', files: ['C:\\a.pdf', 'C:\\b.png'] }, apps, '7');
    expect(tabs).toEqual([{ appId: 'pdf-organizer', request: { key: 'launch:7', params: { launch: 'combine-to-pdf', files: '["C:\\\\a.pdf","C:\\\\b.png"]' } } }]);
  });

  it('hands an app only the entries it declared, and only while it can be used', () => {
    expect(tabsFor({ app: 'pdf-organizer', action: 'format-disk', files: ['C:\\a.pdf'] }, apps, '1')).toEqual([]);
    expect(tabsFor({ app: 'convert', action: 'convert-to', files: ['C:\\a.png'] }, apps, '1')).toEqual([]);
    expect(tabsFor({ app: 'unknown', action: 'combine-to-pdf', files: ['C:\\a.pdf'] }, apps, '1')).toEqual([]);
  });

  it('opens the program in an app from its shortcut, with the files it was given after it', () => {
    expect(tabsFor({ app: 'pdf-organizer', action: null, files: [] }, apps, '1')).toEqual([{ appId: 'pdf-organizer', request: {} }]);
    expect(tabsFor({ app: 'pdf-organizer', action: null, files: ['C:\\a.pdf'] }, apps, '1')).toEqual([
      { appId: 'pdf-organizer', request: {} },
      { appId: 'pdf-organizer', request: { key: 'C:\\a.pdf', title: 'a.pdf', params: { path: 'C:\\a.pdf' } } },
    ]);
    // An app that is not out yet, or not known, has no shortcut.
    expect(tabsFor({ app: 'convert', action: null, files: [] }, apps, '1')).toEqual([]);
    expect(tabsFor({ app: 'unknown', action: null, files: [] }, apps, '1')).toEqual([]);
  });

  it('opens each file in the app that takes its kind', () => {
    const tabs = tabsFor({ app: null, action: null, files: ['C:\\docs\\Act.PDF', 'C:\\notes.txt', 'C:\\photo.png'] }, apps, '1');
    // The text file has no app; the picture's app is not out yet.
    expect(tabs).toEqual([{ appId: 'pdf-organizer', request: { key: 'C:\\docs\\Act.PDF', title: 'Act.PDF', params: { path: 'C:\\docs\\Act.PDF' } } }]);
  });

  it('waits for the copies started together and acts once, on all their files', () => {
    vi.useFakeTimers();
    try {
      const acted: unknown[] = [];
      const gatherer = requestGatherer((requests) => acted.push(requests), 400);
      const one = (file: string) => ({ app: 'pdf-organizer', action: 'combine-to-pdf', files: [file] });
      // The first copy's own start, then the others' as they hand theirs over, each before the wait is up.
      gatherer.add([one('C:\\a.pdf')]);
      vi.advanceTimersByTime(300);
      gatherer.add([one('C:\\b.pdf'), one('C:\\c.pdf')]);
      gatherer.add([]);
      vi.advanceTimersByTime(300);
      gatherer.add([one('C:\\d.pdf')]);
      vi.advanceTimersByTime(399);
      expect(acted).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(acted).toEqual([[{ app: 'pdf-organizer', action: 'combine-to-pdf', files: ['C:\\a.pdf', 'C:\\b.pdf', 'C:\\c.pdf', 'C:\\d.pdf'] }]]);
      // What comes later is a thing of its own; nothing is done after it stops.
      gatherer.add([one('C:\\e.pdf')]);
      gatherer.stop();
      vi.advanceTimersByTime(1000);
      expect(acted).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
