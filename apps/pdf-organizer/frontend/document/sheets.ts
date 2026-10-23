/** A standard sheet of paper, upright, in millimetres. */
export interface Sheet {
  readonly width: number;
  readonly height: number;
  /** Its name, the same in every language: `A4`, `Letter`. */
  readonly label: string;
  readonly group: SheetGroup;
}

/** The families of standard sheets, in the order lists show them. */
export const SHEET_GROUPS = ['iso-a', 'us', 'iso-b', 'iso-c', 'jis-b', 'arch'] as const;
export type SheetGroup = (typeof SHEET_GROUPS)[number];

const series = (group: SheetGroup, prefix: string, key: string, sizes: readonly (readonly [number, number])[], suffix = ''): Record<string, Sheet> =>
  Object.fromEntries(sizes.map(([width, height], number) => [`${key}${number}`, { width, height, label: `${prefix}${number}${suffix}`, group }]));

const named = (group: SheetGroup, sheets: Record<string, readonly [string, number, number]>): Record<string, Sheet> =>
  Object.fromEntries(Object.entries(sheets).map(([key, [label, width, height]]) => [key, { width, height, label, group }]));

/** Every standard sheet a page can be put on or printed on, by a short name used in settings and requests. */
const SHEETS: Readonly<Record<string, Sheet>> = {
  // ISO 216, the "A" sizes used almost everywhere.
  ...series('iso-a', 'A', 'a', [[841, 1189], [594, 841], [420, 594], [297, 420], [210, 297], [148, 210], [105, 148], [74, 105], [52, 74], [37, 52], [26, 37]]),
  // North American sizes.
  ...named('us', {
    letter: ['Letter', 215.9, 279.4],
    legal: ['Legal', 215.9, 355.6],
    tabloid: ['Tabloid / Ledger', 279.4, 431.8],
    executive: ['Executive', 184.2, 266.7],
    statement: ['Statement (Half Letter)', 139.7, 215.9],
    folio: ['Folio', 215.9, 330.2],
    'government-letter': ['Government Letter', 203.2, 266.7],
    'junior-legal': ['Junior Legal', 127, 203.2],
    'ansi-c': ['ANSI C', 431.8, 558.8],
    'ansi-d': ['ANSI D', 558.8, 863.6],
    'ansi-e': ['ANSI E', 863.6, 1117.6],
  }),
  ...series('iso-b', 'B', 'b', [[1000, 1414], [707, 1000], [500, 707], [353, 500], [250, 353], [176, 250], [125, 176], [88, 125], [62, 88], [44, 62], [31, 44]]),
  // Envelopes.
  ...series('iso-c', 'C', 'c', [[917, 1297], [648, 917], [458, 648], [324, 458], [229, 324], [162, 229], [114, 162], [81, 114], [57, 81]]),
  ...named('iso-c', { dl: ['DL', 110, 220] }),
  // The Japanese "B" sizes, a little larger than the ISO ones.
  ...series('jis-b', 'B', 'jis-b', [[1030, 1456], [728, 1030], [515, 728], [364, 515], [257, 364], [182, 257], [128, 182]], ' (JIS)'),
  // Architectural drawings.
  ...named('arch', {
    'arch-a': ['Arch A', 228.6, 304.8],
    'arch-b': ['Arch B', 304.8, 457.2],
    'arch-c': ['Arch C', 457.2, 609.6],
    'arch-d': ['Arch D', 609.6, 914.4],
    'arch-e': ['Arch E', 914.4, 1219.2],
    'arch-e1': ['Arch E1', 762, 1066.8],
  }),
};

export type SheetName = string;
export const SHEET_NAMES: readonly SheetName[] = Object.keys(SHEETS);
export const DEFAULT_SHEET: SheetName = 'a4';

/** The sheet of that name; A4 for a name that is not (or no longer) known. */
export function sheetOf(name: SheetName): Sheet {
  return SHEETS[name] ?? (SHEETS[DEFAULT_SHEET] as Sheet);
}

/** The sheets of one family, in order. */
export function sheetsOf(group: SheetGroup): readonly (readonly [SheetName, Sheet])[] {
  return Object.entries(SHEETS).filter(([, sheet]) => sheet.group === group);
}
