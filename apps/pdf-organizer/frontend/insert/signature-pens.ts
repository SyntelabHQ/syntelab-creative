/** What a signature is drawn with: each a starting color and width the user can then change. */
export interface PenPreset {
  readonly id: 'pen' | 'ballpoint' | 'pencil' | 'fountain' | 'marker';
  /** Name of the icon in the suite's icon set. */
  readonly icon: string;
  readonly color: string;
  /** Width of the line, in pixels of the pad as shown. */
  readonly width: number;
  /** A fountain pen: the line thins out as the hand moves faster. */
  readonly nib?: boolean;
}

export const PEN_PRESETS: readonly PenPreset[] = [
  { id: 'pen', icon: 'pen', color: '#111111', width: 2.4 },
  { id: 'ballpoint', icon: 'pen-clip', color: '#1a3fa8', width: 1.8 },
  { id: 'pencil', icon: 'pencil', color: '#5b6068', width: 1.4 },
  { id: 'fountain', icon: 'pen-nib', color: '#14213d', width: 3.6, nib: true },
  { id: 'marker', icon: 'marker', color: '#c62828', width: 5.5 },
];

export const MIN_PEN_WIDTH = 0.8;
export const MAX_PEN_WIDTH = 10;

/**
 * How wide a fountain pen draws a stretch of line: full width when slow, down
 * to under half when fast, never jumping from the width before.
 * `speed` is in pad pixels per millisecond.
 */
export function nibWidth(width: number, speed: number, previous: number): number {
  const wanted = width * Math.min(Math.max(1.25 - speed * 0.45, 0.4), 1.25);
  return previous + (wanted - previous) * 0.35;
}
