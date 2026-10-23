/** The elements whose start tells HTML from XML, as the Rust side reads them (markup.rs `TELLS_HTML`). */
const TELLS_HTML = new Set(['html', 'head', 'body', 'div', 'span', 'p', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'script', 'style', 'meta', 'br', 'img']);

/**
 * Whether a text is HTML or XML, told from how it begins as the Rust side tells it when the kind is not said:
 * `<?xml` is XML, `<!DOCTYPE html` is HTML, text before any element is HTML, and so is a first element only HTML has.
 */
export function markupKindOf(text: string): 'html' | 'xml' {
  let rest = text.trimStart();
  // Comments say nothing of the kind.
  while (rest.startsWith('<!--')) {
    const end = rest.indexOf('-->');
    if (end < 0) return 'xml';
    rest = rest.slice(end + 3).trimStart();
  }
  if (rest === '') return 'xml';
  if (!rest.startsWith('<')) return 'html';
  if (rest.startsWith('<?')) return rest.startsWith('<?xml') ? 'xml' : markupKindOf(rest.slice(Math.max(rest.indexOf('?>'), 0) + 2));
  if (rest.startsWith('<!')) return /^<!doctype\s+html/i.test(rest) ? 'html' : 'xml';
  const name = /^<([A-Za-z][^\s/>]*)/.exec(rest)?.[1];
  if (name === undefined) return 'html';
  return TELLS_HTML.has(name.toLowerCase()) ? 'html' : 'xml';
}
