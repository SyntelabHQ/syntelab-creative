import { describe, expect, it, vi } from 'vitest';
import { createTabsController } from './tabs-controller';

const ids = (controller: ReturnType<typeof createTabsController>) =>
  controller.store.get().tabs.map((tab) => tab.id);

describe('createTabsController', () => {
  it('starts with the first page of its app, which cannot be closed', () => {
    const controller = createTabsController('pdf-organizer');
    controller.close('app:pdf-organizer');
    expect(ids(controller)).toEqual(['app:pdf-organizer']);
    expect(controller.store.get().activeId).toBe('app:pdf-organizer');
  });

  it('opens another app in its own window, and only its own app in tabs', () => {
    const elsewhere = vi.fn();
    const controller = createTabsController('dev', elsewhere);
    controller.openApp('pdf-organizer');
    controller.openApp('pdf-organizer', { key: 'a.pdf', params: { path: 'C:/a.pdf' } });
    controller.openApp('dev', { key: 'tool:base64' });
    expect(elsewhere.mock.calls).toEqual([['pdf-organizer', undefined], ['pdf-organizer', { key: 'a.pdf', params: { path: 'C:/a.pdf' } }]]);
    expect(ids(controller)).toEqual(['app:dev', 'app:dev:tool:base64']);
  });

  it('opens the first page and Settings once and activates them', () => {
    const controller = createTabsController('pdf-organizer');
    controller.openSettings();
    controller.openApp('pdf-organizer');
    controller.openSettings();
    expect(ids(controller)).toEqual(['app:pdf-organizer', 'settings']);
    expect(controller.store.get().activeId).toBe('settings');
    controller.showHome();
    expect(controller.store.get().activeId).toBe('app:pdf-organizer');
  });

  it('moves to a neighbor when the active tab closes', () => {
    const controller = createTabsController('pdf-organizer');
    controller.openApp('pdf-organizer', { key: 'a.pdf' });
    controller.openSettings();

    controller.activate('app:pdf-organizer:a.pdf');
    controller.close('app:pdf-organizer:a.pdf');
    expect(controller.store.get().activeId).toBe('settings');

    controller.close('settings');
    expect(controller.store.get().activeId).toBe('app:pdf-organizer');
  });

  it('keeps the active tab when another one closes', () => {
    const controller = createTabsController('pdf-organizer');
    controller.openApp('pdf-organizer', { key: 'a.pdf' });
    controller.openSettings();
    controller.close('app:pdf-organizer:a.pdf');
    expect(controller.store.get().activeId).toBe('settings');
    expect(ids(controller)).toEqual(['app:pdf-organizer', 'settings']);
  });

  it('opens one tab per key for the same app', () => {
    const controller = createTabsController('pdf-organizer');
    controller.openApp('pdf-organizer', { key: 'a.pdf', title: 'a.pdf', params: { path: 'C:/a.pdf' } });
    controller.openApp('pdf-organizer', { key: 'b.pdf', title: 'b.pdf' });
    controller.openApp('pdf-organizer', { key: 'a.pdf' });

    expect(ids(controller)).toEqual(['app:pdf-organizer', 'app:pdf-organizer:a.pdf', 'app:pdf-organizer:b.pdf']);
    expect(controller.store.get().activeId).toBe('app:pdf-organizer:a.pdf');
    expect(controller.store.get().tabs[1]).toMatchObject({ title: 'a.pdf', params: { path: 'C:/a.pdf' } });
  });

  it('ignores unknown tabs', () => {
    const controller = createTabsController('pdf-organizer');
    controller.activate('nope');
    expect(controller.store.get().activeId).toBe('app:pdf-organizer');
  });
});

describe('unsaved changes', () => {
  const withUnsavedTab = () => {
    const controller = createTabsController('pdf-organizer');
    controller.openApp('pdf-organizer', { key: 'a.pdf' });
    controller.openSettings();
    controller.setUnsaved('app:pdf-organizer:a.pdf', true);
    return controller;
  };

  it('asks before closing a tab that has some, and shows that tab', () => {
    const controller = withUnsavedTab();
    controller.requestClose('app:pdf-organizer:a.pdf');
    const state = controller.store.get();
    expect(state.pendingClose).toEqual({ kind: 'tab', tabId: 'app:pdf-organizer:a.pdf' });
    expect(state.activeId).toBe('app:pdf-organizer:a.pdf');
    expect(ids(controller)).toContain('app:pdf-organizer:a.pdf');
  });

  it('closes at once when there is nothing to lose', () => {
    const controller = withUnsavedTab();
    controller.requestClose('settings');
    expect(ids(controller)).toEqual(['app:pdf-organizer', 'app:pdf-organizer:a.pdf']);
    expect(controller.store.get().pendingClose).toBeNull();
  });

  it('forgets the question when the user stays or the tab closes', () => {
    const controller = withUnsavedTab();
    controller.requestClose('app:pdf-organizer:a.pdf');
    controller.cancelClose();
    expect(controller.store.get().pendingClose).toBeNull();

    controller.requestClose('app:pdf-organizer:a.pdf');
    controller.close('app:pdf-organizer:a.pdf');
    expect(controller.store.get().pendingClose).toBeNull();
    expect(ids(controller)).toEqual(['app:pdf-organizer', 'settings']);
  });

  it('lets the window close only when no tab has unsaved changes', () => {
    const controller = withUnsavedTab();
    expect(controller.requestCloseWindow()).toBe(false);
    expect(controller.store.get().pendingClose).toEqual({ kind: 'window' });

    controller.cancelClose();
    controller.setUnsaved('app:pdf-organizer:a.pdf', false);
    expect(controller.requestCloseWindow()).toBe(true);
  });

  it('keeps the tab object when its state does not change', () => {
    const controller = withUnsavedTab();
    const before = controller.store.get();
    controller.setUnsaved('app:pdf-organizer:a.pdf', true);
    expect(controller.store.get()).toBe(before);
  });
});

describe('going from tab to tab', () => {
  it('goes around the ends', () => {
    const tabs = createTabsController('pdf-organizer');
    tabs.openApp('pdf-organizer', { key: 'a' });
    tabs.openApp('pdf-organizer', { key: 'b' });
    const active = () => tabs.store.get().activeId;
    tabs.step(1);
    expect(active()).toBe('app:pdf-organizer');
    tabs.step(1);
    expect(active()).toBe('app:pdf-organizer:a');
    tabs.step(-1);
    tabs.step(-1);
    expect(active()).toBe('app:pdf-organizer:b');
  });
});
