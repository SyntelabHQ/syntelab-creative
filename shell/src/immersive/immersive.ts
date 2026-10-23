import type { ImmersiveMode } from '@syntelab/shell-api';
import { useEffect } from 'react';
import { setFullScreen } from '../platform';
import { createStore, useStore } from '../state/create-store';

const mode = createStore<ImmersiveMode>('none');

/**
 * Hides the shell's bars so an app has the whole window (`read`), or the
 * whole screen (`full-screen`). `none` brings everything back.
 */
export function setImmersive(next: ImmersiveMode): void {
  const wasFullScreen = mode.get() === 'full-screen';
  mode.set(next);
  if (wasFullScreen !== (next === 'full-screen')) {
    void setFullScreen(next === 'full-screen').catch((error: unknown) => {
      console.error('[immersive] could not change full screen', error);
    });
  }
}

export function useImmersive(): ImmersiveMode {
  return useStore(mode);
}

/** While the bars are hidden, Escape brings them back. Used once, by the window. */
export function useEscapeLeavesImmersive(): void {
  const current = useImmersive();
  useEffect(() => {
    if (current === 'none') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImmersive('none');
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [current]);
}
