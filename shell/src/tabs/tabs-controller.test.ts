import { describe, expect, it } from 'vitest';
import { createTabsController } from './tabs-controller';

const ids = (controller: ReturnType<typeof createTabsController>) =>
  controller.store.get().tabs.map((tab) => tab.id);

describe('createTabsController', () => {
  it('starts with the Start tab, which cannot be closed', () => {
    const controller = createTabsController();
    controller.close('start');
    expect(ids(controller)).toEqual(['start']);
    expect(controller.store.get().activeId).toBe('start');
  });

  it('opens each app and Settings once and activates them', () => {
    const controller = createTabsController();
    controller.openApp('pdf-organizer');
    controller.openSettings();
    controller.openApp('pdf-organizer');
    expect(ids(controller)).toEqual(['start', 'app:pdf-organizer', 'settings']);
    expect(controller.store.get().activeId).toBe('app:pdf-organizer');
  });

  it('moves to a neighbor when the active tab closes', () => {
    const controller = createTabsController();
    controller.openApp('pdf-organizer');
    controller.openSettings();

    controller.activate('app:pdf-organizer');
    controller.close('app:pdf-organizer');
    expect(controller.store.get().activeId).toBe('settings');

    controller.close('settings');
    expect(controller.store.get().activeId).toBe('start');
  });

  it('keeps the active tab when another one closes', () => {
    const controller = createTabsController();
    controller.openApp('pdf-organizer');
    controller.openSettings();
    controller.close('app:pdf-organizer');
    expect(controller.store.get().activeId).toBe('settings');
    expect(ids(controller)).toEqual(['start', 'settings']);
  });

  it('opens one tab per key for the same app', () => {
    const controller = createTabsController();
    controller.openApp('pdf-organizer', { key: 'a.pdf', title: 'a.pdf', params: { path: 'C:/a.pdf' } });
    controller.openApp('pdf-organizer', { key: 'b.pdf', title: 'b.pdf' });
    controller.openApp('pdf-organizer', { key: 'a.pdf' });

    expect(ids(controller)).toEqual(['start', 'app:pdf-organizer:a.pdf', 'app:pdf-organizer:b.pdf']);
    expect(controller.store.get().activeId).toBe('app:pdf-organizer:a.pdf');
    expect(controller.store.get().tabs[1]).toMatchObject({ title: 'a.pdf', params: { path: 'C:/a.pdf' } });
  });

  it('ignores unknown tabs', () => {
    const controller = createTabsController();
    controller.activate('nope');
    expect(controller.store.get().activeId).toBe('start');
  });
});

describe('unsaved changes', () => {
  const withUnsavedTab = () => {
    const controller = createTabsController();
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
    expect(ids(controller)).toEqual(['start', 'app:pdf-organizer:a.pdf']);
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
    expect(ids(controller)).toEqual(['start', 'settings']);
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
  it('goes around the ends, passing over the tabs it is told to', () => {
    const tabs = createTabsController();
    tabs.openApp('pdf-organizer', { key: 'a' });
    tabs.openApp('pdf-organizer', { key: 'b' });
    const active = () => tabs.store.get().activeId;
    tabs.step(1);
    expect(active()).toBe('start');
    tabs.step(-1);
    expect(active()).toBe('app:pdf-organizer:b');
    // Start has no tab of its own: it is not stopped at.
    const start = (tab: { kind: string }) => tab.kind === 'start';
    tabs.step(1, start);
    expect(active()).toBe('app:pdf-organizer:a');
    tabs.step(-1, start);
    expect(active()).toBe('app:pdf-organizer:b');
    // From Start itself, the keys still lead away from it.
    tabs.showStart();
    tabs.step(1, start);
    expect(active()).toBe('app:pdf-organizer:a');
  });
});
