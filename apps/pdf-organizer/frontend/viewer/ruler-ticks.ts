/** One mark on a ruler. */
export interface RulerTick {
  /** Where it is along the ruler, in pixels from the ruler's start. */
  readonly at: number;
  /** A long mark with its number, or a short one between numbers. */
  readonly major: boolean;
  /** The number to write beside a long mark, in the ruler's unit. */
  readonly label: string;
}

/** Steps between numbered marks, in units: the smallest that leaves room for the numbers is used. */
const STEPS = [0.125, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
/** Numbered marks are at least this far apart, in pixels. */
const ROOM_FOR_A_NUMBER = 46;
/** Short marks closer together than this, in pixels, would be a grey band: fewer are drawn. */
const ROOM_FOR_A_MARK = 4;

/**
 * The marks of a ruler `length` pixels long whose zero lies `origin` pixels
 * from its start (the edge of the page), when one unit is `unitPixels` wide.
 */
export function rulerTicks(origin: number, length: number, unitPixels: number): RulerTick[] {
  if (!(unitPixels > 0) || !(length > 0) || !Number.isFinite(origin)) return [];
  const step = STEPS.find((candidate) => candidate * unitPixels >= ROOM_FOR_A_NUMBER) ?? STEPS[STEPS.length - 1]!;
  // Ten short marks to a number where they fit, else five, else two.
  const parts = [10, 5, 2].find((count) => (step * unitPixels) / count >= ROOM_FOR_A_MARK) ?? 1;
  const minor = step / parts;
  const first = Math.ceil(-origin / (minor * unitPixels));
  const last = Math.floor((length - origin) / (minor * unitPixels));
  const ticks: RulerTick[] = [];
  for (let index = first; index <= last; index++) {
    const major = index % parts === 0;
    // Rounded: steps like 0.125 are exact, sums of 0.1 are not.
    const value = Math.round(index * minor * 1000) / 1000;
    ticks.push({ at: origin + index * minor * unitPixels, major, label: major ? String(Math.abs(value)) : '' });
  }
  return ticks;
}
