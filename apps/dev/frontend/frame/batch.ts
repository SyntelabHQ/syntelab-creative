/** Many files worked on in one run: what is asked of the Rust side, and what it answers. */

/** A file to work on, as `find_files` gives it. */
export interface FoundFile {
  readonly path: string;
  /** The folder that was chosen and under which the file was found; null for a file chosen by itself. */
  readonly root: string | null;
  /** In bytes. */
  readonly size: number;
}

/**
 * How the name of a result is made from the name of its file: a mark before the ending (`data.json` → `data.min.json`),
 * an ending more (`data.json` → `data.json.gz`), another ending (`data.yaml` → `data.json`), or an ending less (`data.json.gz` → `data.json`; a file that does not end
 * so gets the mark `otherwise` instead).
 */
export type Rename = { readonly mark: string } | { readonly append: string } | { readonly ending: string } | { readonly strip: string; readonly otherwise: string };

/** Where the results go: beside each file under a name made from its own, into a folder, or over the files themselves; or nowhere, shown in the list (`shown`: results that are short, as digests are). */
export type BatchTarget = { readonly kind: 'shown' } | ({ readonly kind: 'beside' } & Rename) | ({ readonly kind: 'folder'; readonly folder: string } & Partial<Record<'mark' | 'append' | 'ending' | 'strip' | 'otherwise', string>>) | { readonly kind: 'replace' };

/** How a tool names its results. */
export interface Naming {
  /** Beside its file, a result must have another name. */
  readonly beside: Rename;
  /** In a folder of their own, results keep the names of their files unless this says otherwise. */
  readonly inFolder?: Rename;
  /** What a result written beside `name` is called, to show the user: `name.formatted.json`. */
  readonly example: string;
  /** The results cannot take the place of their files (they are of another kind: a `.gz` is not its `.json`). */
  readonly noReplace?: boolean;
}

export const TARGET_KINDS = ['shown', 'beside', 'folder', 'replace'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** How one file came out. */
export interface BatchItem {
  readonly path: string;
  /** Where its result was written; null when nothing was. */
  readonly out: string | null;
  /** Its result, when that is shown and not written. */
  readonly said?: string | null;
  /** `wrong`: not what the tool takes (with `code`, `line`, `column`). `skipped`, `failed`: with `code`. */
  readonly status: 'done' | 'wrong' | 'skipped' | 'failed';
  readonly code: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly bytesIn: number;
  readonly bytesOut: number;
  readonly ms: number;
}

/** What a run came to, counted. */
export interface BatchTotals {
  readonly done: number;
  readonly wrong: number;
  readonly skipped: number;
  readonly failed: number;
  readonly bytesIn: number;
  readonly bytesOut: number;
}

export function totalsOf(items: readonly BatchItem[]): BatchTotals {
  const totals = { done: 0, wrong: 0, skipped: 0, failed: 0, bytesIn: 0, bytesOut: 0 };
  for (const item of items) {
    totals[item.status] += 1;
    totals.bytesIn += item.bytesIn;
    totals.bytesOut += item.bytesOut;
  }
  return totals;
}

/** The files of both lists, each once (by its path), in the order they were first given. */
export function addFiles(known: readonly FoundFile[], more: readonly FoundFile[]): FoundFile[] {
  const paths = new Set(known.map((file) => file.path));
  const added = more.filter((file) => !paths.has(file.path) && paths.add(file.path));
  return [...known, ...added];
}

/**
 * The results that were shown, as one text to copy: a result of one line as the checksum programs write it
 * (`digest  path`, which they read back), a longer one under the path of its file.
 */
export function shownAsText(items: readonly BatchItem[]): string {
  return items
    .filter((item) => item.status === 'done' && typeof item.said === 'string' && item.said !== '')
    .map((item) => ((item.said ?? '').includes('\n') ? `${item.path}\n${item.said}\n` : `${item.said}  ${item.path}`))
    .join('\n')
    .concat('\n');
}

/** The folder a file is in, and its name. */
export function splitPath(path: string): { readonly folder: string; readonly name: string } {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return { folder: path.slice(0, Math.max(at, 0)), name: path.slice(at + 1) };
}
