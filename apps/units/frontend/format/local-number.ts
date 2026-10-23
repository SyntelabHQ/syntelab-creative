/**
 * Numbers as the language of the program writes them. The Rust side answers
 * with plain digits (`1234.5`, `1.6e-35`); here they get the marks of the
 * language: what stands before the decimals, and what between thousands.
 */

export interface NumberMarks {
  /** Before the decimals: `.` or `,`. */
  readonly decimal: string;
  /** Between thousands; empty where the language writes none. */
  readonly group: string;
}

/** What the user chose to write between thousands: a space, a comma (a point where the language's decimals follow a comma), or nothing. */
export type Thousands = 'space' | 'comma' | 'none';

/** The mark between thousands the user chose, for a language with this decimal mark. A space that does not break a number in two. */
export function thousandsMark(thousands: Thousands, decimal: string): string {
  if (thousands === 'none') return '';
  if (thousands === 'space') return '\u00A0';
  return decimal === ',' ? '.' : ',';
}

const known = new Map<string, NumberMarks>();

/** The marks a language writes numbers with. */
export function marksOf(language: string): NumberMarks {
  let marks = known.get(language);
  if (!marks) {
    let parts: Intl.NumberFormatPart[] = [];
    try {
      // Western digits whatever the language: the values are read next to symbols written with them.
      parts = new Intl.NumberFormat(language, { numberingSystem: 'latn' }).formatToParts(1234567.5);
    } catch {
      parts = [];
    }
    const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';
    marks = { decimal: decimal === ',' ? ',' : '.', group: parts.find((part) => part.type === 'group')?.value ?? '' };
    known.set(language, marks);
  }
  return marks;
}

const RAISED: Readonly<Record<string, string>> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

function grouped(whole: string, group: string): string {
  // Four digits are read at a glance; from five on they are grouped.
  if (group === '' || whole.length < 5) return whole;
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
}

const PLAIN = /^-?\d+(\.\d+)?(e-?\d+)?$/;

/**
 * A number as the Rust side writes it, written as the language does. `1.6e-35` becomes 1.6 × 10⁻³⁵. With `thousands`,
 * what stands between thousands is the user's choice instead of the language's.
 */
export function localNumber(text: string, language: string, thousands?: Thousands): string {
  // What is not a plain number (a dash for "no such value") is left as it is.
  if (!PLAIN.test(text)) return text;
  const marks = marksOf(language);
  const [mantissa = '', power] = text.split('e');
  const negative = mantissa.startsWith('-');
  const [whole = '', part] = (negative ? mantissa.slice(1) : mantissa).split('.');
  const group = thousands === undefined ? marks.group : thousandsMark(thousands, marks.decimal);
  const written = `${negative ? '−' : ''}${grouped(whole, group)}${part === undefined ? '' : marks.decimal + part}`;
  if (power === undefined) return written;
  return `${written} × 10${[...power].map((letter) => RAISED[letter] ?? letter).join('')}`;
}

/** The same number as it is copied: with the decimal mark of the language, nothing between thousands, and `e` for a power of ten, so a spreadsheet reads it. */
export function copiedNumber(text: string, language: string): string {
  if (!PLAIN.test(text)) return text;
  return text.replace('.', marksOf(language).decimal);
}
