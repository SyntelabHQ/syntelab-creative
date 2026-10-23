/** How a field of a schedule is chosen in the builder: every value, every n-th, or the values picked. */
export interface BuiltField {
  readonly mode: 'every' | 'step' | 'chosen';
  /** For `step`: every so many. */
  readonly step: number;
  /** For `chosen`: the values picked, in any order. */
  readonly chosen: readonly number[];
}

/** A schedule as it is chosen in the builder. */
export interface Built {
  /** A field for seconds goes first. */
  readonly withSeconds: boolean;
  readonly second: BuiltField;
  readonly minute: BuiltField;
  readonly hour: BuiltField;
  readonly dayOfMonth: BuiltField;
  readonly month: BuiltField;
  readonly dayOfWeek: BuiltField;
}

export const BUILT_FIELDS = ['second', 'minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'] as const;
export type BuiltName = (typeof BUILT_FIELDS)[number];

/** The values each field can hold, from the first to the last. */
export const RANGES: Readonly<Record<BuiltName, readonly [number, number]>> = { second: [0, 59], minute: [0, 59], hour: [0, 23], dayOfMonth: [1, 31], month: [1, 12], dayOfWeek: [0, 6] };

const every: BuiltField = { mode: 'every', step: 5, chosen: [] };
const at = (value: number): BuiltField => ({ mode: 'chosen', step: 5, chosen: [value] });

/** What the builder starts with: every day at nine. */
export const STARTS_WITH: Built = { withSeconds: false, second: at(0), minute: at(0), hour: at(9), dayOfMonth: every, month: every, dayOfWeek: every };

/** Values as cron writes a list of them: three or more that follow one another as a range. */
function listed(values: readonly number[]): string {
  const sorted = [...new Set(values)].sort((one, other) => one - other);
  const parts: string[] = [];
  for (let from = 0; from < sorted.length; ) {
    let to = from;
    while (to + 1 < sorted.length && sorted[to + 1] === (sorted[to] ?? 0) + 1) to += 1;
    if (to - from >= 2) parts.push(`${sorted[from]}-${sorted[to]}`);
    else for (let one = from; one <= to; one++) parts.push(String(sorted[one]));
    from = to + 1;
  }
  return parts.join(',');
}

/** A field as cron writes it. Nothing picked, or everything, is every value. */
export function writtenField(field: BuiltField, [least, most]: readonly [number, number]): string {
  if (field.mode === 'step') return field.step > 1 ? `*/${field.step}` : '*';
  if (field.mode === 'every' || field.chosen.length === 0) return '*';
  const inRange = field.chosen.filter((value) => value >= least && value <= most);
  return new Set(inRange).size === most - least + 1 ? '*' : listed(inRange);
}

/**
 * The schedule the builder holds, as cron writes it: five fields, or six
 * with seconds first. The days of the week are numbered from 0 for Sunday,
 * as crontab has them; the other forms are made from this one by the tool.
 */
export function build(built: Built): string {
  const names = built.withSeconds ? BUILT_FIELDS : BUILT_FIELDS.slice(1);
  return names.map((name) => writtenField(built[name], RANGES[name])).join(' ');
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** A value of a field as a number: written in figures, or by the name a month or a day of the week has. */
function valueOf(written: string, name: BuiltName): number | null {
  if (/^\d+$/.test(written)) return Number(written);
  const known = name === 'month' ? MONTHS.indexOf(written.toLowerCase()) + 1 : name === 'dayOfWeek' ? DAYS.indexOf(written.toLowerCase()) : -1;
  return name === 'month' ? (known > 0 ? known : null) : known >= 0 ? known : null;
}

/** A field of cron as the builder holds it; null when it says what the builder cannot (`L`, `W`, `#`, `?`). */
function readField(written: string, name: BuiltName): BuiltField | null {
  const [least, most] = RANGES[name];
  if (written === '*') return every;
  const stepped = /^\*\/(\d+)$/.exec(written);
  if (stepped) return { mode: 'step', step: Math.max(1, Number(stepped[1])), chosen: [] };
  const chosen: number[] = [];
  for (const part of written.split(',')) {
    const [range = '', step] = part.split('/');
    const [from, to] = range.split('-');
    const first = range === '*' ? least : valueOf(from ?? '', name);
    // A value with a step and no end goes on to the last the field holds.
    const last = range === '*' ? most : to !== undefined ? valueOf(to, name) : step !== undefined ? most : first;
    const by = step === undefined ? 1 : Number(step);
    if (first === null || last === null || !Number.isInteger(by) || by < 1) return null;
    for (let value = first; value <= last; value += by) {
      // Sunday is written as 7 too.
      const held = name === 'dayOfWeek' && value === 7 ? 0 : value;
      if (held < least || held > most) return null;
      if (!chosen.includes(held)) chosen.push(held);
    }
    if (last < first) return null;
  }
  return chosen.length > 0 ? { mode: 'chosen', step: 5, chosen } : null;
}

/**
 * A schedule written as cron writes it (five fields, or six with seconds
 * first), as the builder holds it; null when it says something the builder
 * has no way to choose.
 */
export function read(expression: string): Built | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) return null;
  const withSeconds = fields.length === 6;
  const names = withSeconds ? BUILT_FIELDS : BUILT_FIELDS.slice(1);
  const held: Partial<Record<BuiltName, BuiltField>> = { second: at(0) };
  for (const [index, name] of names.entries()) {
    const field = readField(fields[index] ?? '', name);
    if (field === null) return null;
    held[name] = field;
  }
  return { withSeconds, ...(held as Record<BuiltName, BuiltField>) };
}
