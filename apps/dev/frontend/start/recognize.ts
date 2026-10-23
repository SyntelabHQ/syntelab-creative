/** What a pasted text may be, and the tools that work on such a thing (the one that fits best first). */
export interface Guess {
  /** What it looks like: a key of the translations under `dev.start.looks.`. */
  readonly kind: string;
  /** Ids of tools in the catalog. */
  readonly tools: readonly string[];
}

/** How much of a long text is looked at: what a thing is shows at its start. */
const LOOKED_AT = 64 * 1024;
/** JSON is read whole to be sure of it, up to this length; a longer text is told by how it begins and ends. */
const READ_WHOLE_UP_TO = 2 * 1024 * 1024;

const UUID = /^(urn:uuid:)?\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;
const MOMENT = /^(-?\d{9,19}(\.\d+)?|\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?)$/;
const CRON = /^(@(yearly|annually|monthly|weekly|daily|midnight|hourly|reboot)|([\d*/,?LW#A-Za-z-]+\s+){4,6}[\d*/,?LW#A-Za-z-]+)$/i;
const DIGEST = /^([0-9a-f]{8}|[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{96}|[0-9a-f]{128})$/i;
const SQL = /^\s*(select|insert\s+into|update|delete\s+from|create|alter|drop|with|truncate|merge|grant|begin)\b/i;

const every = (lines: readonly string[], pattern: RegExp) => lines.length > 0 && lines.every((line) => pattern.test(line));

function isUrl(line: string): boolean {
  if (!/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(line) && !/^mailto:\S+@\S+$/i.test(line)) return false;
  try {
    return new URL(line).href !== '';
  } catch {
    return false;
  }
}

/** A part of a token as the text it holds: Base64 for addresses, without its filling. */
function fromBase64Url(part: string): string | null {
  try {
    return atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
  } catch {
    return null;
  }
}

function isJwt(text: string): boolean {
  const token = text.replace(/^Bearer\s+/i, '');
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(token)) return false;
  const header = fromBase64Url(token.split('.')[0] ?? '');
  return header !== null && /^\s*\{[\s\S]*"alg"/.test(header);
}

function isJson(text: string): boolean {
  const opens = text[0];
  const closes = text[text.length - 1];
  if (!((opens === '{' && closes === '}') || (opens === '[' && closes === ']'))) return false;
  if (text.length > READ_WHOLE_UP_TO) return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** The sign that stands between the fields of every line the same number of times, at least once; null when none does. */
function separatorOf(lines: readonly string[]): string | null {
  if (lines.length < 2) return null;
  return [',', ';', '\t', '|'].find((sign) => {
    const counts = lines.map((line) => line.split(sign).length - 1);
    return (counts[0] ?? 0) > 0 && counts.every((count) => count === counts[0]);
  }) ?? null;
}

/**
 * Tells what a pasted text may be, from how it is written: the most
 * particular things first (a token, a certificate), then the more common
 * ones, and at the end what can be done with any text. Nothing is run and
 * nothing is kept: the text is only looked at.
 */
export function recognize(pasted: string): Guess[] {
  const text = pasted.trim();
  if (text === '') return [];
  const start = text.slice(0, LOOKED_AT);
  const lines = start
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  // A long text was cut: its last line may not be whole, and is not judged.
  const whole = text.length > LOOKED_AT ? lines.slice(0, -1) : lines;
  const guesses: Guess[] = [];
  const add = (kind: string, ...tools: string[]) => guesses.push({ kind, tools });

  if (isJwt(text)) add('jwt', 'jwt');
  if (start.includes('-----BEGIN CERTIFICATE-----')) add('certificate', 'certificate');
  const json = isJson(text);
  if (json) add('json', 'json-formatter', 'jsonpath', 'json-to-typescript', 'json-schema-generator', 'yaml-json', ...(text.startsWith('[') ? ['csv-json'] : []), 'diff');
  if (every(whole, UUID)) add('uuid', 'uuid');
  if (every(whole, MOMENT)) add('timestamp', 'timestamp');
  // Words alone are no schedule: a schedule has a number, a star or a question mark in it, or is an alias.
  if (every(whole, CRON) && whole.every((line) => line.startsWith('@') || /[\d*?]/.test(line)) && !every(whole, MOMENT)) add('cron', 'cron');
  if (whole.length > 0 && whole.every(isUrl)) add('url', 'url-parser', 'url-encode');
  if (start.startsWith('<') && (text.endsWith('>') || text.length > LOOKED_AT)) add(/^<!doctype html|^<html[\s>]/i.test(start) ? 'html' : 'xml', 'markup');
  if (SQL.test(start) && !json) add('sql', 'sql');
  if (start.startsWith('H4sI')) add('gzip', 'gzip');
  if (whole.length === 1 && DIGEST.test(whole[0] ?? '')) add('digest', 'hash');
  const packed = start.replace(/\s+/g, '');
  if (!json && packed.length >= 16 && packed.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(packed) && !/^[0-9a-f]+$/i.test(packed) && !/^\d+$/.test(packed)) add('base64', 'base64');
  if (/%[0-9A-Fa-f]{2}/.test(start) && !guesses.some((guess) => guess.kind === 'url')) add('percent', 'url-encode');
  if (/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,30});/i.test(start) && !start.startsWith('<')) add('entities', 'html-entities');
  if (/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[nrt"\\])/.test(start) && !json) add('escaped', 'escape');
  if (guesses.length === 0 || guesses.every((guess) => ['percent', 'entities', 'escaped'].includes(guess.kind))) {
    if (separatorOf(whole) !== null) add('csv', 'csv-json');
    else if (whole.some((line) => /^[\w."'-]+:(\s|$)/.test(line) || /^- \S/.test(line))) add('yaml', 'yaml-json');
  }
  // What can be done with any text at all.
  add('text', 'hash', 'base64', 'regex', 'diff', 'url-encode');
  return guesses;
}
