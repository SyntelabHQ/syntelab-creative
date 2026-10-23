/** What the JSON formatter does with what it is given, and how. Kept between uses: it is a setting, not something typed. */

export const MODES = ['format', 'minify', 'validate'] as const;
export type Mode = (typeof MODES)[number];

/** How far each level is pushed in when the text is formatted: the usual ones, or a number of spaces of the user's own. */
export const INDENTS = ['2', '4', 'tab', 'custom'] as const;
export type Indent = (typeof INDENTS)[number];

export const LINE_ENDINGS = ['lf', 'crlf'] as const;
export type LineEnding = (typeof LINE_ENDINGS)[number];

/** What can be done to the values before they are written: nothing, or one of these. */
export const CHANGES = ['none', 'drop-nulls', 'drop-empties', 'flatten', 'unflatten', 'stringify', 'parse'] as const;
export type Change = (typeof CHANGES)[number];

/** The choices that are on or off, in the order the menu lists them. */
export const SWITCHES = ['sortKeys', 'oneLine', 'colonSpace', 'finalNewline', 'ascii', 'lenient'] as const;
export type Switch = (typeof SWITCHES)[number];

export interface JsonOptions {
  readonly mode: Mode;
  readonly indent: Indent;
  /** The spaces of each level when `indent` is `custom`: from 0 (each item on its line, nothing pushed in) to `MOST_SPACES`. */
  readonly spaces: number;
  /** The members of every object in the order of their keys. */
  readonly sortKeys: boolean;
  /** An array or an object that fits on one line is written on one. */
  readonly oneLine: boolean;
  /** A space after the colon of each key. */
  readonly colonSpace: boolean;
  /** A line break after the last sign. */
  readonly finalNewline: boolean;
  /** Letters that are not ASCII are written as `\uXXXX`. */
  readonly ascii: boolean;
  /** Comments and a comma after the last item are let by, and not written again. */
  readonly lenient: boolean;
  readonly lineEnding: LineEnding;
  readonly change: Change;
}

/** The most spaces a level can be pushed in by: what the Rust side takes. */
export const MOST_SPACES = 255;

/** A line is this long, for telling what is short enough to stay on one. */
const LINE_LENGTH = 80;

export const DEFAULT_OPTIONS: JsonOptions = { mode: 'format', indent: '2', spaces: 3, sortKeys: false, oneLine: false, colonSpace: true, finalNewline: false, ascii: false, lenient: false, lineEnding: 'lf', change: 'none' };

/** Options as stored, made whole: what is missing or not valid is as the program ships it. */
export function readOptions(stored: unknown): JsonOptions {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_OPTIONS;
  const values = stored as Record<string, unknown>;
  const { mode, indent, spaces, lineEnding, change } = values;
  const flag = (name: Switch) => (typeof values[name] === 'boolean' ? (values[name] as boolean) : DEFAULT_OPTIONS[name]);
  return {
    spaces: typeof spaces === 'number' && Number.isInteger(spaces) && spaces >= 0 && spaces <= MOST_SPACES ? spaces : DEFAULT_OPTIONS.spaces,
    mode: MODES.includes(mode as Mode) ? (mode as Mode) : DEFAULT_OPTIONS.mode,
    indent: INDENTS.includes(indent as Indent) ? (indent as Indent) : DEFAULT_OPTIONS.indent,
    sortKeys: flag('sortKeys'),
    oneLine: flag('oneLine'),
    colonSpace: flag('colonSpace'),
    finalNewline: flag('finalNewline'),
    ascii: flag('ascii'),
    lenient: flag('lenient'),
    lineEnding: LINE_ENDINGS.includes(lineEnding as LineEnding) ? (lineEnding as LineEnding) : DEFAULT_OPTIONS.lineEnding,
    change: CHANGES.includes(change as Change) ? (change as Change) : DEFAULT_OPTIONS.change,
  };
}

/** The indent as the Rust side is told it: `tab`, or a number of spaces. */
export const indentAsked = (options: Pick<JsonOptions, 'indent' | 'spaces'>): string => (options.indent === 'custom' ? String(options.spaces) : options.indent);

/** The options as the `json` commands of the Rust side take them. */
export function waysOf(options: JsonOptions): Readonly<Record<string, unknown>> {
  return {
    mode: options.mode,
    indent: indentAsked(options),
    lenient: options.lenient,
    colonSpace: options.colonSpace,
    lineEnding: options.lineEnding,
    finalNewline: options.finalNewline,
    ascii: options.ascii,
    sortKeys: options.sortKeys,
    oneLineWithin: options.oneLine ? LINE_LENGTH : 0,
    change: options.change === 'none' ? '' : options.change,
  };
}

/**
 * With these options the document is held whole in memory, not read as it goes by: a very large file then needs
 * memory in step with its size. Nothing is held when the text is only checked.
 */
export const heldWhole = (options: JsonOptions): boolean => options.mode !== 'validate' && (options.sortKeys || options.change !== 'none' || (options.oneLine && options.mode === 'format'));

/** What is put before the ending of a result, to tell it from the file it came from. */
export const resultMark = (mode: Mode): string => (mode === 'minify' ? 'min' : 'formatted');

/** The name a result is offered under: `data.json` gives `data.formatted.json` or `data.min.json`. */
export function resultName(inputName: string | null, mode: Mode): string {
  const mark = resultMark(mode);
  if (inputName === null || inputName === '') return `${mark}.json`;
  const dot = inputName.lastIndexOf('.');
  return `${dot > 0 ? inputName.slice(0, dot) : inputName}.${mark}.json`;
}
