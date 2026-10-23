/**
 * What the network tools work out by themselves from what is typed: the
 * headers of a request, the host and port of an address, the same request
 * as a command of curl, and what an answer is by the kind it says it is.
 */

/** The headers as they are typed, one to a line (`Name: value`). `bad` is the first line that is none. */
export function headersOf(typed: string): { readonly pairs: readonly (readonly [string, string])[]; readonly bad: string | null } {
  const pairs: [string, string][] = [];
  for (const line of typed.split(/\r?\n/)) {
    const text = line.trim();
    // An empty line, or one set aside with a number sign, is passed over.
    if (text === '' || text.startsWith('#')) continue;
    const colon = text.indexOf(':');
    if (colon <= 0) return { pairs, bad: text };
    pairs.push([text.slice(0, colon).trim(), text.slice(colon + 1).trim()]);
  }
  return { pairs, bad: null };
}

/** A text as one word of a shell: between single quotes, with a single quote inside written as `'\''`. */
const quoted = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

export interface RequestTold {
  readonly method: string;
  readonly url: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
  /** A file sent as the body, in place of `body`. */
  readonly bodyFile?: string | null;
  /** The request is sent on to where the server points. */
  readonly follow: boolean;
  readonly verifyTls: boolean;
}

/** The request as a command of curl, for a shell that reads single quotes as sh does. */
export function curlOf(request: RequestTold): string {
  const parts = ['curl'];
  const file = request.bodyFile ?? null;
  if (request.method !== 'GET' || request.body !== '' || file !== null) parts.push('-X', request.method);
  parts.push(quoted(request.url));
  for (const [name, value] of request.headers) parts.push('-H', quoted(`${name}: ${value}`));
  if (file !== null) parts.push('--data-binary', quoted(`@${file}`));
  else if (request.body !== '') parts.push('--data-raw', quoted(request.body));
  if (request.follow) parts.push('-L');
  if (!request.verifyTls) parts.push('-k');
  return parts.join(' ');
}

/** The language the editors colour an answer in, from the kind it says it is. */
export function syntaxOf(contentType: string | undefined): 'json' | 'xml' | 'html' | 'yaml' | undefined {
  const kind = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (kind === 'application/json' || kind.endsWith('+json')) return 'json';
  if (kind === 'text/html') return 'html';
  if (kind === 'application/xml' || kind === 'text/xml' || kind.endsWith('+xml')) return 'xml';
  if (kind.endsWith('/yaml') || kind.endsWith('/x-yaml')) return 'yaml';
  return undefined;
}

/** How an answer stands by its number: well (2xx), sent elsewhere (3xx), not well (4xx, 5xx), or only told (1xx). */
export function statusKind(status: number): 'fine' | 'moved' | 'wrong' | 'told' {
  if (status >= 200 && status < 300) return 'fine';
  if (status >= 300 && status < 400) return 'moved';
  return status >= 400 ? 'wrong' : 'told';
}

/**
 * The host and the port in what is typed: a name or an address, with a port
 * after a colon or not (`example.com`, `example.com:8443`, `[::1]:443`), or
 * a whole web address, whose host is taken. Null when there is no host.
 */
export function hostAndPort(typed: string, otherwise: number): { readonly host: string; readonly port: number } | null {
  let text = typed.trim();
  if (text === '') return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const port = url.port !== '' ? Number(url.port) : url.protocol === 'http:' ? 80 : otherwise;
      return url.hostname === '' ? null : { host: url.hostname.replace(/^\[|\]$/g, ''), port };
    } catch {
      return null;
    }
  }
  text = text.replace(/\/.*$/, '');
  // An IPv6 address in figures has colons of its own: a port follows it only after square brackets.
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
  if (bracketed) return port(bracketed[1] ?? '', bracketed[2], otherwise);
  if ((text.match(/:/g) ?? []).length > 1) return { host: text, port: otherwise };
  const [host = '', given] = text.split(':');
  return port(host, given, otherwise);
}

function port(host: string, given: string | undefined, otherwise: number): { readonly host: string; readonly port: number } | null {
  if (host === '') return null;
  if (given === undefined || given === '') return { host, port: otherwise };
  const number = Number(given);
  return /^\d+$/.test(given) && number >= 1 && number <= 65535 ? { host, port: number } : null;
}
