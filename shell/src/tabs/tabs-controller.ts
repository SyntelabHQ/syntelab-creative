import type { AppTabParams, AppTabRequest } from '@syntelab/shell-api';
import { createStore } from '../state/create-store';
import type { Store } from '../state/create-store';
import { openAppWindow, WINDOW_APP } from './window-app';

export type TabKind = 'settings' | 'help' | 'app';

export interface Tab {
  readonly id: string;
  readonly kind: TabKind;
  /** Set for `app` tabs. */
  readonly appId?: string;
  /** Set by the app (a file name…); otherwise the tab shows the app's name. */
  readonly title?: string;
  /** Values the app attached to the tab. */
  readonly params?: AppTabParams;
  readonly closable: boolean;
  /** The app says the tab holds changes that closing it would lose. */
  readonly unsaved?: boolean;
}

/** What the user asked to close while it holds unsaved changes: one tab, or the whole window. */
export type PendingClose = { readonly kind: 'tab'; readonly tabId: string } | { readonly kind: 'window' };

export interface TabsState {
  readonly tabs: readonly Tab[];
  readonly activeId: string;
  /** Waiting for the user to confirm; null most of the time. */
  readonly pendingClose: PendingClose | null;
}

export interface TabsController {
  readonly store: Store<TabsState>;
  /** The app of this window: its first page is the first tab, always there. */
  readonly homeApp: string;
  activate(id: string): void;
  /** Brings the first page of this window's app to the front. */
  showHome(): void;
  openSettings(): void;
  /** Goes to the next tab (`by` 1) or the one before (-1), around the ends. */
  step(by: 1 | -1): void;
  /** Opens the manual in its tab, or brings that tab to the front. */
  openHelp(): void;
  /** Opens a tab of this window's app, or activates it when the same key is already open. Another app opens in its own window. */
  openApp(appId: string, request?: AppTabRequest): void;
  /** Closes the tab, whatever it holds. */
  close(id: string): void;
  /** Closes the tab, asking first when it has unsaved changes. */
  requestClose(id: string): void;
  /**
   * The user wants to close the program. Returns true when that can happen
   * right away; false when a question about unsaved changes was put up first.
   */
  requestCloseWindow(): boolean;
  /** Forgets the question about unsaved changes (the user chose to stay). */
  cancelClose(): void;
  setUnsaved(id: string, unsaved: boolean): void;
}

const SETTINGS_TAB: Tab = { id: 'settings', kind: 'settings', closable: true };
const HELP_TAB: Tab = { id: 'help', kind: 'help', closable: true };

/**
 * The tabs of one window: those of its app, with Settings and Help beside them. The app's first page is always
 * there. `openElsewhere` opens another app in its own window; without it (the browser preview) another app opens
 * in a tab here.
 */
export function createTabsController(homeApp: string, openElsewhere?: (appId: string, request?: AppTabRequest) => void): TabsController {
  const homeTab: Tab = { id: `app:${homeApp}`, kind: 'app', appId: homeApp, closable: false };
  const store = createStore<TabsState>({ tabs: [homeTab], activeId: homeTab.id, pendingClose: null });

  /** Activates the tab, adding it first when it is not open yet. */
  const open = (tab: Tab) => {
    store.set((state) => ({
      ...state,
      tabs: state.tabs.some((existing) => existing.id === tab.id) ? state.tabs : [...state.tabs, tab],
      activeId: tab.id,
    }));
  };

  const close = (id: string) => {
    store.set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      if (index === -1 || !state.tabs[index]?.closable) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      const pendingClose = state.pendingClose?.kind === 'tab' && state.pendingClose.tabId === id ? null : state.pendingClose;
      if (state.activeId !== id) return { ...state, tabs, pendingClose };
      // Closing the active tab moves to its neighbor, preferring the next one.
      const neighbor = tabs[Math.min(index, tabs.length - 1)] ?? homeTab;
      return { tabs, activeId: neighbor.id, pendingClose };
    });
  };

  return {
    store,
    homeApp,
    activate(id) {
      store.set((state) => (state.tabs.some((tab) => tab.id === id) ? { ...state, activeId: id } : state));
    },
    step(by) {
      store.set((state) => {
        const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
        const next = state.tabs[(index + by + state.tabs.length) % state.tabs.length];
        return next && next.id !== state.activeId ? { ...state, activeId: next.id } : state;
      });
    },
    showHome: () => open(homeTab),
    openSettings: () => open(SETTINGS_TAB),
    openHelp: () => open(HELP_TAB),
    openApp(appId, asked) {
      // Without a tab to open, the other app's window only comes to the front, as the user left it.
      if (appId !== homeApp && openElsewhere) return openElsewhere(appId, asked);
      const request = asked ?? {};
      const id = request.key === undefined ? `app:${appId}` : `app:${appId}:${request.key}`;
      open({ id, kind: 'app', appId, title: request.title, params: request.params, closable: true });
    },
    close,
    requestClose(id) {
      const tab = store.get().tabs.find((candidate) => candidate.id === id);
      if (!tab?.unsaved) return close(id);
      // Show what is about to be lost, then ask.
      store.set((state) => ({ ...state, activeId: id, pendingClose: { kind: 'tab', tabId: id } }));
    },
    requestCloseWindow() {
      const unsaved = store.get().tabs.find((tab) => tab.unsaved);
      if (!unsaved) return true;
      store.set((state) => ({ ...state, activeId: unsaved.id, pendingClose: { kind: 'window' } }));
      return false;
    },
    cancelClose() {
      store.set((state) => (state.pendingClose ? { ...state, pendingClose: null } : state));
    },
    setUnsaved(id, unsaved) {
      store.set((state) => {
        const tab = state.tabs.find((candidate) => candidate.id === id);
        if (!tab || (tab.unsaved ?? false) === unsaved) return state;
        return { ...state, tabs: state.tabs.map((candidate) => (candidate === tab ? { ...tab, unsaved } : candidate)) };
      });
    },
  };
}

export const tabs = createTabsController(WINDOW_APP, openAppWindow);
