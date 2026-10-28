import { createStore, useStore } from '../state/create-store';

/** Whether the search window is open: the search on top opens it, and Ctrl+K. */
const paletteOpen = createStore(false);

export const openPalette = (): void => paletteOpen.set(true);
export const closePalette = (): void => paletteOpen.set(false);
export const usePaletteOpen = (): boolean => useStore(paletteOpen);
