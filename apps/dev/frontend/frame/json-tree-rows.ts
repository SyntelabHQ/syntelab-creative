/** The rows of a JSON tree that are in sight, worked out from what is open and what has been asked for so far. */

/** A value as the Rust side gives it for a row. */
export interface TreeRow {
  /** Its key, for a member of an object. */
  readonly key: string | null;
  readonly kind: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  /** How many members or items it holds. */
  readonly children: number;
  /** A scalar as it is written. */
  readonly text: string;
}

/** The members of a value that have been asked for so far, from its first on. */
export interface Loaded {
  readonly rows: readonly TreeRow[];
}

/** A row that is drawn: a value, or the offer to ask for more members of the value before it. */
export type Drawn =
  | { readonly kind: 'value'; readonly way: readonly number[]; readonly row: TreeRow; /** What stands before it: its key, its place in its array, nothing for the document itself. */ readonly label: string | null }
  | { readonly kind: 'more'; /** The way to where the next member would stand. */ readonly way: readonly number[]; readonly shown: number; readonly left: number };

/** A way of places as one text, to tell values apart by. */
export const wayKey = (way: readonly number[]): string => way.join('/');

/**
 * The rows in sight, top to bottom: the document, then under every open value the members that were asked for,
 * and, where there are more, a row that offers them. Gone through with a list of what is still to do, not by
 * calls within calls: a document may be nested deeper than those could go.
 */
export function flatten(root: TreeRow, loaded: ReadonlyMap<string, Loaded>, open: ReadonlySet<string>): Drawn[] {
  const drawn: Drawn[] = [];
  const todo: Drawn[] = [{ kind: 'value', way: [], row: root, label: null }];
  while (todo.length > 0) {
    const next = todo.pop() as Drawn;
    drawn.push(next);
    if (next.kind !== 'value') continue;
    const key = wayKey(next.way);
    if (!open.has(key)) continue;
    const members = loaded.get(key)?.rows ?? [];
    const under: Drawn[] = members.map((row, place) => ({ kind: 'value', way: [...next.way, place], row, label: next.row.kind === 'array' ? String(place) : row.key }));
    if (members.length < next.row.children) under.push({ kind: 'more', way: [...next.way, members.length], shown: members.length, left: next.row.children - members.length });
    // Put on the list last first, so the first member is the next to be drawn.
    for (let at = under.length - 1; at >= 0; at--) todo.push(under[at] as Drawn);
  }
  return drawn;
}
