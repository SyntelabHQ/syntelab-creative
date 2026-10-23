import { describe, expect, it } from 'vitest';
import { flatten, wayKey } from './json-tree-rows';
import type { Loaded, TreeRow } from './json-tree-rows';

const row = (kind: TreeRow['kind'], key: string | null = null, children = 0, text = ''): TreeRow => ({ key, kind, children, text });

/** What a row says of itself, on one line: where it is and what stands before it. */
const said = (rows: ReturnType<typeof flatten>) => rows.map((drawn) => (drawn.kind === 'more' ? `more@${wayKey(drawn.way)} (${drawn.left} left)` : `${wayKey(drawn.way) || 'root'}:${drawn.label ?? '-'}`));

describe('flatten', () => {
  const root = row('object', null, 2);
  const loaded = new Map<string, Loaded>([
    ['', { rows: [row('array', 'list', 5), row('string', 'name', 0, '"x"')] }],
    ['0', { rows: [row('number', null, 0, '1'), row('object', null, 1)] }],
    ['0/1', { rows: [row('null', 'none', 0, 'null')] }],
  ]);

  it('shows only the document while nothing is open', () => {
    expect(said(flatten(root, loaded, new Set()))).toEqual(['root:-']);
  });

  it('shows the members of what is open, in their order, with the place of each item of an array', () => {
    expect(said(flatten(root, loaded, new Set(['', '0', '0/1'])))).toEqual(['root:-', '0:list', '0/0:0', '0/1:1', '0/1/0:none', 'more@0/2 (3 left)', '1:name']);
  });

  it('offers the members that were not asked for yet', () => {
    expect(said(flatten(root, new Map(), new Set(['']))).at(-1)).toBe('more@0 (2 left)');
  });

  it('goes as deep as the document does', () => {
    const deep = new Map<string, Loaded>();
    const open = new Set<string>();
    const way: number[] = [];
    for (let depth = 0; depth < 3_000; depth++) {
      deep.set(wayKey(way), { rows: [row('array', null, 1)] });
      open.add(wayKey(way));
      way.push(0);
    }
    expect(flatten(row('array', null, 1), deep, open)).toHaveLength(3_001);
  });
});
