/**
 * The tools of Scribe, as the panel lists them: each with the choices it
 * offers. What a tool does is done on the Rust side (`ops/`); here a tool is
 * only its name, its choices and the operation they make.
 */

/** What every choice of a tool can say of itself, whatever its kind. */
interface FieldTraits {
  /** The choice matters only while another one (`field`) is one of these values: it is shown only then. */
  readonly when?: { readonly field: string; readonly is: readonly (string | boolean)[] };
  /** One of the choices fewer people need: shown under "More choices". */
  readonly more?: boolean;
  /** For a choice of one of a few: every option is in sight, as a button, instead of in a list that has to be opened. */
  readonly spread?: boolean;
}

/** A choice of a tool: one of a few, a switch, a text, a number, or a language (its code, or `auto` for the language of the program). */
export type ToolField = FieldTraits &
  (
  | { readonly name: string; readonly kind: 'choice'; readonly options: readonly string[]; readonly initial: string }
  | { readonly name: string; readonly kind: 'flag'; readonly initial: boolean }
  | { readonly name: string; readonly kind: 'text'; readonly initial: string; /** Written as it is typed: spaces at its ends count. */ readonly exact?: boolean }
  /** A text of several lines. */
  | { readonly name: string; readonly kind: 'lines'; readonly initial: string }
  | { readonly name: string; readonly kind: 'number'; readonly initial: number; readonly min: number; readonly max: number }
  | { readonly name: string; readonly kind: 'language'; readonly options: readonly string[]; readonly initial: typeof PROGRAM_LANGUAGE }
);

/** In a choice of language: the language the program is in, whatever it is when the tool runs. */
export const PROGRAM_LANGUAGE = 'auto';

/** The languages whose order of letters can be asked for by name. Each sorts its own way: ä is a letter of its own in Swedish, a kind of a in German. */
const SORT_LANGUAGES: readonly string[] = ['ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'he', 'hr', 'hu', 'is', 'it', 'ja', 'ko', 'lt', 'lv', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'tr', 'uk', 'vi', 'zh'];

export type ToolValues = Readonly<Record<string, string | number | boolean>>;

export const TOOL_GROUPS = ['replace', 'lines', 'case', 'direction', 'clean', 'make'] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

export interface Tool {
  /** The `kind` of its operation on the Rust side, and its name in the translations (`scribe.tool.<id>`). */
  readonly id: string;
  readonly group: ToolGroup;
  /** Name of a file in `assets/icons/`, without the extension. */
  readonly icon: string;
  readonly fields: readonly ToolField[];
  /** The sorting follows the order of letters of a language: the operation is told which. */
  readonly usesLanguage?: boolean;
  /** Values that cannot be applied as they are (nothing to find): the tool waits for them. */
  readonly needs?: readonly string[];
  /** It writes a text instead of changing one (`generate/` on the Rust side): what it gives goes where the cursor is. */
  readonly makes?: boolean;
  /** It goes online, at the address the user types and only when asked: the one tool that does. */
  readonly online?: boolean;
}

const flag = (name: string, initial = false): ToolField => ({ name, kind: 'flag', initial });
const choice = (name: string, options: readonly string[]): ToolField => ({ name, kind: 'choice', options, initial: options[0] ?? '' });
/** The same choice, with every option in sight. */
const spread = (field: ToolField): ToolField => ({ ...field, spread: true });
const text = (name: string, initial = '', exact = true): ToolField => ({ name, kind: 'text', initial, exact });
const number = (name: string, initial: number, min: number, max: number): ToolField => ({ name, kind: 'number', initial, min, max });
/** The same choice, shown only while another is one of some values. */
const when = (field: ToolField, other: string, ...is: (string | boolean)[]): ToolField => ({ ...field, when: { field: other, is } });
/** The same choices, under "More choices". */
const more = (...fields: ToolField[]): ToolField[] => fields.map((field) => ({ ...field, more: true }));

/** The part of a line that is compared, with what finds it: shared by the tools that sort lines and hold them for the same. */
const PART_OF_LINE: ToolField[] = [choice('key', ['line', 'word', 'character', 'column']), when(number('position', 1, 1, 10_000), 'key', 'word', 'character', 'column'), when(text('delimiter', ','), 'key', 'column')];

export const TOOLS: readonly Tool[] = [
  {
    id: 'replace',
    group: 'replace',
    icon: 'magnifying-glass',
    fields: [text('find'), text('with'), flag('regex'), flag('caseSensitive'), flag('wholeWord'), flag('keepCase'), ...more(flag('fill'))],
    needs: ['find'],
  },
  { id: 'replaceMany', group: 'replace', icon: 'list-check', fields: [{ name: 'pairs', kind: 'lines', initial: '' }, flag('regex'), flag('caseSensitive'), flag('wholeWord'), flag('keepCase')], needs: ['pairs'] },

  {
    id: 'sortLines',
    group: 'lines',
    icon: 'arrows-up-down',
    fields: [
      choice('by', ['alphabetical', 'natural', 'numeric', 'length', 'words', 'date', 'ip', 'version', 'title', 'custom', 'random']),
      when(text('order', '', false), 'by', 'custom'),
      when(choice('dateOrder', ['dayFirst', 'monthFirst']), 'by', 'date'),
      when(flag('descending'), 'by', 'alphabetical', 'natural', 'numeric', 'length', 'words', 'date', 'ip', 'version', 'title', 'custom'),
      flag('caseSensitive'),
      ...more({ name: 'language', kind: 'language', options: SORT_LANGUAGES, initial: PROGRAM_LANGUAGE }, ...PART_OF_LINE, flag('keepHeader'), flag('blocks'), flag('trim'), flag('removeEmpty'), flag('unique')),
    ],
    usesLanguage: true,
  },
  {
    id: 'removeDuplicates',
    group: 'lines',
    icon: 'clone',
    fields: [
      choice('keep', ['first', 'last', 'none']),
      flag('caseSensitive'),
      flag('ignoreSpaces'),
      flag('adjacentOnly'),
      ...more(choice('empty', ['asOthers', 'keep', 'remove', 'collapse']), flag('ignoreNumbers'), flag('ignorePunctuation'), number('skipStart', 0, 0, 10_000), number('skipEnd', 0, 0, 10_000), ...PART_OF_LINE, text('pattern')),
    ],
  },
  {
    id: 'countLines',
    group: 'lines',
    icon: 'list-check',
    fields: [choice('order', ['mostFirst', 'leastFirst', 'asMet', 'alphabetical']), flag('repeatedOnly'), flag('caseSensitive'), flag('ignoreSpaces'), ...more(text('separator', '\\t'), flag('ignoreNumbers'), flag('ignorePunctuation'), ...PART_OF_LINE)],
    usesLanguage: true,
  },
  { id: 'filterLines', group: 'lines', icon: 'bars', fields: [text('find'), choice('mode', ['keep', 'drop']), flag('regex'), flag('caseSensitive'), flag('wholeWord')], needs: ['find'] },
  { id: 'reverseLines', group: 'lines', icon: 'right-left', fields: [] },
  { id: 'shuffleLines', group: 'lines', icon: 'rotate', fields: [] },
  { id: 'numberLines', group: 'lines', icon: 'list-ol', fields: [{ name: 'start', kind: 'number', initial: 1, min: -1_000_000, max: 1_000_000_000 }, text('separator', '. '), flag('pad'), flag('skipEmpty')] },
  { id: 'emptyLines', group: 'lines', icon: 'minus', fields: [choice('mode', ['remove', 'collapse'])] },
  { id: 'joinLines', group: 'lines', icon: 'compress', fields: [text('separator', ' ')] },
  { id: 'splitLines', group: 'lines', icon: 'expand', fields: [text('separator', ', ')], needs: ['separator'] },

  { id: 'changeCase', group: 'case', icon: 'font', fields: [spread(choice('to', ['sentence', 'title', 'upper', 'lower', 'inverted', 'camel', 'pascal', 'snake', 'constant', 'kebab']))] },

  { id: 'reverseText', group: 'direction', icon: 'right-left', fields: [spread(choice('what', ['letters', 'words', 'eachWord', 'upsideDown', 'mirror']))] },

  { id: 'cleanSpaces', group: 'clean', icon: 'eraser', fields: [] },
  { id: 'trimLines', group: 'clean', icon: 'scissors', fields: [spread(choice('side', ['both', 'start', 'end']))] },
  { id: 'quotes', group: 'clean', icon: 'pen-nib', fields: [spread(choice('to', ['straight', 'english', 'romanian', 'german', 'french']))] },
  { id: 'removeDiacritics', group: 'clean', icon: 'i-cursor', fields: [] },
  { id: 'repairRomanian', group: 'clean', icon: 'check-double', fields: [] },
  { id: 'restoreRomanian', group: 'clean', icon: 'wand-magic-sparkles', fields: [flag('guess')] },
  { id: 'tabsToSpaces', group: 'clean', icon: 'arrow-right-long', fields: [{ name: 'width', kind: 'number', initial: 4, min: 1, max: 16 }] },
  { id: 'spacesToTabs', group: 'clean', icon: 'arrow-right', fields: [{ name: 'width', kind: 'number', initial: 4, min: 1, max: 16 }] },
  { id: 'stripHtml', group: 'clean', icon: 'globe', fields: [] },
  // Beside the tool it is looked for with: one takes the tags out of a source, the other brings the page itself.
  { id: 'webPageText', group: 'clean', icon: 'globe', makes: true, online: true, fields: [text('address', '', false)], needs: ['address'] },

  {
    id: 'fillerText',
    group: 'make',
    icon: 'pen-to-square',
    makes: true,
    fields: [
      choice('words', ['latin', 'english', 'romanian', 'business', 'food', 'custom']),
      when(text('ownWords', '', false), 'words', 'custom'),
      choice('unit', ['paragraphs', 'sentences', 'words', 'lists', 'headings', 'page']),
      number('count', 3, 1, 50_000),
      when(number('items', 5, 1, 100), 'unit', 'lists', 'page'),
      when(flag('ordered'), 'unit', 'lists', 'page'),
      when(flag('classicStart', true), 'words', 'latin'),
      ...more(choice('sentences', ['mixed', 'short', 'medium', 'long']), choice('format', ['plain', 'markdown', 'html', 'json']), when(number('level', 2, 1, 6), 'unit', 'headings', 'page'), number('limit', 0, 0, 10_000_000), text('leaveOut', '', false), number('seed', 0, 0, 999_999_999)),
    ],
    needs: ['ownWords'],
  },
  {
    id: 'sampleData',
    group: 'make',
    icon: 'address-card',
    makes: true,
    fields: [
      choice('what', ['names', 'emails', 'phones', 'addresses', 'dates', 'numbers', 'pattern']),
      when(text('pattern', '{name} <{email}>', false), 'what', 'pattern'),
      number('count', 10, 1, 100_000),
      when(choice('region', ['romania', 'english']), 'what', 'names', 'emails', 'phones', 'addresses', 'dates', 'pattern'),
      when(number('from', 1, -1_000_000_000, 1_000_000_000), 'what', 'numbers', 'pattern'),
      when(number('to', 100, -1_000_000_000, 1_000_000_000), 'what', 'numbers', 'pattern'),
      ...more(number('seed', 0, 0, 999_999_999)),
    ],
    needs: ['pattern'],
  },
  { id: 'randomText', group: 'make', icon: 'keyboard', makes: true, fields: [choice('what', ['password', 'lettersDigits', 'letters', 'digits', 'hex', 'uuid']), number('length', 16, 1, 4096), number('lines', 1, 1, 10_000), flag('noLookalikes')] },
];

export function toolById(id: string): Tool | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

/** The tools whose account of what they did counts places in the text (matches, letters, marks); the others count lines. */
const COUNT_PLACES: readonly string[] = ['replace', 'replaceMany', 'splitLines', 'joinLines', 'quotes', 'removeDiacritics', 'repairRomanian', 'restoreRomanian', 'stripHtml'];

/** What the number a tool answers with counts. */
export function countsOf(tool: Tool): 'places' | 'lines' {
  return COUNT_PLACES.includes(tool.id) ? 'places' : 'lines';
}

/** The choices of a tool that matter with these values: one that depends on another is left out while the other says so. */
export function visibleFields(tool: Tool, values: ToolValues): readonly ToolField[] {
  return tool.fields.filter((field) => {
    if (!field.when) return true;
    const other = tool.fields.find((known) => known.name === field.when?.field);
    const value = values[field.when.field] ?? other?.initial ?? '';
    return (field.when.is as readonly (string | number | boolean)[]).includes(value);
  });
}

/** What a tool's choices are before the user touches them. */
export function initialValues(tool: Tool): ToolValues {
  return Object.fromEntries(tool.fields.map((field) => [field.name, field.initial]));
}

/** The values with one changed; a number is kept inside what its field allows. */
export function withValue(tool: Tool, values: ToolValues, name: string, value: string | number | boolean): ToolValues {
  const field = tool.fields.find((known) => known.name === name);
  if (!field) return values;
  if (field.kind === 'number') {
    const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : field.initial;
    return { ...values, [name]: Math.min(Math.max(number, field.min), field.max) };
  }
  return { ...values, [name]: value };
}

/** True when the tool can be applied with these values. */
export function isReady(tool: Tool, values: ToolValues): boolean {
  // What is needed counts only while it is a choice that shows: the user's own words, when the filler is made of them.
  const shown = visibleFields(tool, values).map((field) => field.name);
  return (tool.needs ?? []).every((name) => !shown.includes(name) || String(values[name] ?? tool.fields.find((field) => field.name === name)?.initial ?? '').trim() !== '');
}

/** The operation the Rust side is asked for: the tool's kind with its choices, and the language where it counts. */
export function operationOf(tool: Tool, values: ToolValues, language: string): Record<string, unknown> {
  const chosen = values.language;
  // The language asked for by name; else the one the program is in.
  const sortedAs = typeof chosen === 'string' && chosen !== PROGRAM_LANGUAGE && chosen !== '' ? chosen : language;
  // Blanks that say the day and the hour are filled with the user's own clock, as their language writes it.
  const clock = values.fill === true ? { today: new Date().toLocaleDateString(language), now: new Date().toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }) } : {};
  return { kind: tool.id, ...initialValues(tool), ...values, ...(tool.usesLanguage ? { language: sortedAs } : {}), ...clock };
}
