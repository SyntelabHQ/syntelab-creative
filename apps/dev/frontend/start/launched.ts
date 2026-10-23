import { fileEnding } from '@syntelab/shell-api';
/**
 * What a Dev tab was opened with from outside the program: an entry of the
 * file manager's right-click menu chosen on some files (`launch` and `files`
 * among the tab's parameters), or a file opened with the program (`path`).
 * Which tool that is for is decided here, from the entry and from the
 * ending of the file.
 */

/** A choice of a tool turned to what the file needs: a `.csv` is read toward JSON, not written from it. */
export interface TurnedOption {
  /** The key the tool keeps its options under. */
  readonly key: string;
  readonly values: Readonly<Record<string, string>>;
}

export interface Launched {
  /** The tool to open, by its id in the catalog. */
  readonly tool: string;
  /** The files it is to open, as full paths. */
  readonly files: readonly string[];
  readonly turned?: TurnedOption;
  /** The files go to the list of files worked on in one run, even when there is one (which may be a folder). */
  readonly listed?: boolean;
  /** What was chosen are folders. */
  readonly folders?: boolean;
}

/** The entries Dev has in the right-click menu, as `app.json` names them. */
export const LAUNCH_ACTIONS = ['open', 'checksum', 'hex', 'compare', 'compare-folders'] as const;

interface Opener {
  readonly tool: string;
  readonly turned?: TurnedOption;
}

const toJson = (tool: string): Opener => ({ tool, turned: { key: `${tool}.options`, values: { direction: 'decode' } } });
const markup = (kind: string): Opener => ({ tool: 'markup', turned: { key: 'markup.options', values: { kind } } });

/** The tool each kind of file is opened in, by its ending in small letters. */
const OPENERS: Readonly<Record<string, Opener>> = {
  json: { tool: 'json-formatter' },
  yaml: toJson('yaml-json'),
  yml: toJson('yaml-json'),
  csv: toJson('csv-json'),
  tsv: toJson('csv-json'),
  xml: markup('xml'),
  html: markup('html'),
  htm: markup('html'),
  sql: { tool: 'sql' },
  pem: { tool: 'certificate' },
  crt: { tool: 'certificate' },
  cer: { tool: 'certificate' },
  der: { tool: 'certificate' },
  gz: toJson('gzip'),
  md: { tool: 'markdown' },
  markdown: { tool: 'markdown' },
  pfx: { tool: 'keys' },
  p12: { tool: 'keys' },
  key: { tool: 'keys' },
  csr: { tool: 'keys' },
  pub: { tool: 'keys' },
};

/** The tool a file is opened in. One of a kind no tool reads is shown as its bytes: that can be done with any file. */
export function openerOf(path: string): Opener {
  return OPENERS[fileEnding(path)] ?? { tool: 'hex' };
}

function filesOf(written: string | undefined): string[] {
  if (written === undefined) return [];
  try {
    const files: unknown = JSON.parse(written);
    return Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string' && file !== '') : [];
  } catch {
    return [];
  }
}

/** What the tab was opened with; null for a tab that was opened from inside the program. */
export function launchedBy(params: Readonly<Record<string, string | undefined>>): Launched | null {
  const files = params.launch !== undefined ? filesOf(params.files) : params.path ? [params.path] : [];
  const [first] = files;
  if (first === undefined) return null;
  // Digests are listed, each beside its file: the entry is also chosen on folders, whose files are all listed.
  if (params.launch === 'checksum') return { tool: 'hash', files, listed: true };
  if (params.launch === 'hex') return { tool: 'hex', files };
  if (params.launch === 'compare') return { tool: 'diff', files };
  if (params.launch === 'compare-folders') return { tool: 'diff', files, folders: true };
  // Files of several kinds chosen together go by the first of them.
  return { ...openerOf(first), files };
}
