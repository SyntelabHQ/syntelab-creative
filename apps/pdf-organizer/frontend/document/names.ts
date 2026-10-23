/** Characters a file name cannot have on one system or another. */
const NOT_IN_A_NAME = /[<>:"/\\|?*\u0000-\u001f]/g;

/** A file name without its `.pdf` (or other) ending. */
export function withoutExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/**
 * A file name made from a pattern: `{name}` stands for the name of the
 * document it comes from, `{number}` for a number written with at least
 * `digits` digits. Always ends in `.pdf`, never empty.
 */
export function fillName(pattern: string, values: { name?: string; number?: number }, digits: number): string {
  const number = values.number === undefined ? '' : String(values.number).padStart(digits, '0');
  const filled = pattern
    .split('{name}')
    .join(values.name ?? '')
    .split('{number}')
    .join(number)
    .replace(NOT_IN_A_NAME, '_')
    .trim()
    // A name cannot end in a dot or a space on Windows.
    .replace(/[. ]+$/, '');
  return `${filled || 'document'}.pdf`;
}

/** The name of pages taken out of `sourceFileName` as one document. */
export function extractedName(pattern: string, sourceFileName: string): string {
  return fillName(pattern, { name: withoutExtension(sourceFileName) }, 2);
}

/** The name of the `number`-th page taken out of `sourceFileName` on its own (counted from 1). */
export function extractedEachName(pattern: string, sourceFileName: string, number: number): string {
  return fillName(pattern, { name: withoutExtension(sourceFileName), number }, 2);
}

/** The name of the `number`-th document the program made new. */
export function newDocumentName(pattern: string, number: number): string {
  return fillName(pattern, { number }, 5);
}
