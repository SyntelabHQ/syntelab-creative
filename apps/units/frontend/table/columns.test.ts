import { describe, expect, it } from 'vitest';
import { drawnOrder, moved, pinned, sharedWidths, toggled, withPrecision, withWidth } from './columns';
import type { Columns } from './columns';

const columns: Columns = { order: ['m', 'ft', 'in', 'km'], widths: {}, pinnedStart: [], pinnedEnd: [], precision: {} };

describe('the columns of a table', () => {
  it('adds a unit at the end and takes one out', () => {
    expect(toggled(columns, 'mi').order).toEqual(['m', 'ft', 'in', 'km', 'mi']);
    const held = pinned(columns, 'ft', 'start');
    expect(toggled(held, 'ft')).toEqual({ ...columns, order: ['m', 'in', 'km'] });
  });

  it('draws the columns held at an edge there', () => {
    const held = pinned(pinned(columns, 'km', 'start'), 'm', 'end');
    expect(drawnOrder(held)).toEqual(['km', 'ft', 'in', 'm']);
    // Held at the other edge: let go of the first.
    expect(drawnOrder(pinned(held, 'km', 'end'))).toEqual(['ft', 'in', 'm', 'km']);
    // Asked again where it is: let go.
    expect(drawnOrder(pinned(held, 'km', 'start'))).toEqual(['ft', 'in', 'km', 'm']);
  });

  it('moves a column among those beside it', () => {
    expect(moved(columns, 'ft', -1).order).toEqual(['ft', 'm', 'in', 'km']);
    expect(moved(columns, 'ft', 1).order).toEqual(['m', 'in', 'ft', 'km']);
    expect(moved(columns, 'm', -1)).toBe(columns);
    expect(moved(columns, 'km', 1)).toBe(columns);
    // A column held at an edge does not change places with one that is not.
    const held = pinned(columns, 'm', 'start');
    expect(moved(held, 'ft', -1)).toBe(held);
  });

  it('keeps the precision and the width of a column within bounds', () => {
    expect(withPrecision(columns, 'm', 4).precision).toEqual({ m: 4 });
    expect(withPrecision(columns, 'm', 99).precision).toEqual({ m: 30 });
    expect(withPrecision(withPrecision(columns, 'm', 4), 'm', null).precision).toEqual({});
    expect(withWidth(columns, 'm', 10).widths).toEqual({ m: 48 });
    // Taken out, a column forgets its width.
    expect(toggled(withWidth(columns, 'm', 300), 'm').widths).toEqual({});
  });

  it('shares the room equally among the columns that were given no width', () => {
    const free = { width: null, least: 100 };
    expect(sharedWidths([free, free], 900)).toEqual([450, 450]);
    expect(sharedWidths([free, free, free], 900)).toEqual([300, 300, 300]);
    // What does not divide goes to the last.
    expect(sharedWidths([free, free, free], 1000)).toEqual([333, 333, 334]);
    // A column that was dragged keeps its width; the others share the rest.
    expect(sharedWidths([{ width: 200, least: 100 }, free, free], 900)).toEqual([200, 350, 350]);
    // A head that needs more than its share takes it; the others share what is left.
    expect(sharedWidths([{ width: null, least: 500 }, free, free], 900)).toEqual([500, 200, 200]);
    // No room for all: each at its least, and the table is scrolled sideways.
    expect(sharedWidths([free, free, free], 200)).toEqual([100, 100, 100]);
  });
});
