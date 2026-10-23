import type { AppEntry } from '@syntelab/shell-api';
import { useMemo } from 'react';
import { preferences } from '../preferences';
import { createStore, useStore } from '../state/create-store';
import { loadApps } from './app-catalog';
import { orderApps } from './app-order';

export interface AppsState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly apps: readonly AppEntry[];
}

const appsStore = createStore<AppsState>({ status: 'loading', apps: [] });
let started = false;

function start(): void {
  if (started) return;
  started = true;
  loadApps().then(
    (apps) => appsStore.set({ status: 'ready', apps }),
    (error: unknown) => {
      console.error('[apps] could not load the app list', error);
      appsStore.set({ status: 'error', apps: [] });
    },
  );
}

/** The app list, loaded once for the whole shell, in the order the user arranged it. */
export function useApps(): AppsState {
  start();
  const state = useStore(appsStore);
  const { appOrder } = useStore(preferences);
  return useMemo(() => ({ ...state, apps: orderApps(state.apps, appOrder) }), [state, appOrder]);
}
