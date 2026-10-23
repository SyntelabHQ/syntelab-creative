import type { AppHost } from '@syntelab/shell-api';
import type { ConverterInfo } from '../engine/units-api';

/**
 * The columns of a converter's table, as the user left them: which units, in
 * which order, how wide, which are held at an edge, and the precision asked
 * for a column. Kept on this computer, by converter.
 */
export interface Columns {
  /** The units shown, in order (before those held at an edge are moved there). */
  readonly order: readonly string[];
  /** Widths in pixels, for the columns that were dragged or fitted. The others share the room that is left, equally. */
  readonly widths: Readonly<Record<string, number>>;
  /** The width of the column of row numbers, once it was dragged or fitted. */
  readonly numbersWidth?: number;
  /** Held at the start, and at the end, of the table while it is scrolled sideways. */
  readonly pinnedStart: readonly string[];
  readonly pinnedEnd: readonly string[];
  /** Decimals asked for a column: they change that column only, never the unit's own. */
  readonly precision: Readonly<Record<string, number>>;
}

const NARROWEST_COLUMN = 48;
const NARROWEST_NUMBERS = 32;
const WIDEST_NUMBERS = 240;
const WIDEST_COLUMN = 900;
/** The most decimals a column can be asked for. */
export const MOST_DECIMALS = 30;

// Named anew when what a table starts with changed, so tables kept before start as they now should.
const DATA_KEY = 'tableColumns';
type Storage = Pick<AppHost, 'loadData' | 'saveData'>;

function stored(host: Pick<AppHost, 'loadData'>): Readonly<Record<string, Partial<Columns>>> {
  const value = host.loadData<unknown>(DATA_KEY);
  return typeof value === 'object' && value !== null ? (value as Record<string, Partial<Columns>>) : {};
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
const numbers = (value: unknown): Record<string, number> => (typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))) : {});

/** The columns of a converter. Before the user chooses any: the units the converter starts with (metre and foot, for length). */
/** The units a table of a converter starts with: those the user chose for it, else the converter's own. */
export function startingUnits(converter: ConverterInfo, chosen: readonly string[] | undefined): string[] {
  const known = (chosen ?? []).filter((id) => converter.units.some((unit) => unit.id === id));
  return known.length > 0 ? known : [...converter.startsWith];
}

export function columnsOf(host: Pick<AppHost, 'loadData'>, converter: ConverterInfo, starting?: readonly string[]): Columns {
  const known = (id: string) => converter.units.some((unit) => unit.id === id);
  const kept = stored(host)[converter.id];
  const chosen = strings(kept?.order).filter(known);
  const order = kept?.order ? chosen : startingUnits(converter, starting);
  return {
    order: [...new Set(order)],
    widths: numbers(kept?.widths),
    numbersWidth: typeof kept?.numbersWidth === 'number' && Number.isFinite(kept.numbersWidth) ? kept.numbersWidth : undefined,
    pinnedStart: strings(kept?.pinnedStart).filter((id) => order.includes(id)),
    pinnedEnd: strings(kept?.pinnedEnd).filter((id) => order.includes(id)),
    precision: numbers(kept?.precision),
  };
}

export function saveColumns(host: Storage, converterId: string, columns: Columns): void {
  host.saveData(DATA_KEY, { ...stored(host), [converterId]: columns });
}

/** The units in the order they are drawn: those held at the start, the others, those held at the end. */
export function drawnOrder(columns: Columns): string[] {
  const start = columns.order.filter((id) => columns.pinnedStart.includes(id));
  const end = columns.order.filter((id) => columns.pinnedEnd.includes(id));
  return [...start, ...columns.order.filter((id) => !start.includes(id) && !end.includes(id)), ...end];
}

/** The width a column was given, or null while it shares the room with the others. */
export const widthOf = (columns: Columns, id: string): number | null => (columns.widths[id] === undefined ? null : Math.min(Math.max(Math.round(columns.widths[id]), NARROWEST_COLUMN), WIDEST_COLUMN));

// How the columns share the room is the grid's: it is here for those who ask Units for it.
export { sharedWidths } from '@syntelab/data-grid';

/** A unit added as the last column, or taken out. */
export function toggled(columns: Columns, id: string): Columns {
  if (!columns.order.includes(id)) return { ...columns, order: [...columns.order, id] };
  // Its width goes with it: put back, it shares the room again.
  const widths = Object.fromEntries(Object.entries(columns.widths).filter(([known]) => known !== id));
  return { ...columns, widths, order: columns.order.filter((known) => known !== id), pinnedStart: columns.pinnedStart.filter((known) => known !== id), pinnedEnd: columns.pinnedEnd.filter((known) => known !== id) };
}

/** A column moved one place towards the start (-1) or the end (+1), among those drawn beside it. */
export function moved(columns: Columns, id: string, by: -1 | 1): Columns {
  const drawn = drawnOrder(columns);
  const at = drawn.indexOf(id);
  const other = drawn[at + by];
  // Only among its like: a column held at an edge does not change places with one that is not.
  const held = (unit: string) => (columns.pinnedStart.includes(unit) ? 'start' : columns.pinnedEnd.includes(unit) ? 'end' : 'none');
  if (at < 0 || other === undefined || held(other) !== held(id)) return columns;
  const order = [...columns.order];
  const [one, two] = [order.indexOf(id), order.indexOf(other)];
  order[one] = other;
  order[two] = id;
  return { ...columns, order };
}

/** A column held at the start or at the end, or let go when it is held there already. */
export function pinned(columns: Columns, id: string, edge: 'start' | 'end'): Columns {
  const [here, there] = edge === 'start' ? ([columns.pinnedStart, columns.pinnedEnd] as const) : ([columns.pinnedEnd, columns.pinnedStart] as const);
  const next = here.includes(id) ? here.filter((known) => known !== id) : [...here, id];
  const others = there.filter((known) => known !== id);
  return edge === 'start' ? { ...columns, pinnedStart: next, pinnedEnd: others } : { ...columns, pinnedEnd: next, pinnedStart: others };
}

/** The precision asked for a column; `null` takes it back to the unit's own. */
export function withPrecision(columns: Columns, id: string, decimals: number | null): Columns {
  const precision = { ...columns.precision };
  if (decimals === null) delete precision[id];
  else precision[id] = Math.min(Math.max(Math.round(decimals), 0), MOST_DECIMALS);
  return { ...columns, precision };
}

export function withWidth(columns: Columns, id: string, width: number): Columns {
  return { ...columns, widths: { ...columns.widths, [id]: Math.min(Math.max(Math.round(width), NARROWEST_COLUMN), WIDEST_COLUMN) } };
}

export function withNumbersWidth(columns: Columns, width: number): Columns {
  return { ...columns, numbersWidth: Math.min(Math.max(Math.round(width), NARROWEST_NUMBERS), WIDEST_NUMBERS) };
}
