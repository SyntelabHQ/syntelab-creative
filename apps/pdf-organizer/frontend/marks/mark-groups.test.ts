import { describe, expect, it } from 'vitest';
import type { PlanPage } from '../document/page-plan';
import type { Mark } from './mark';
import { pagesOfGroup, repeatedOn, withGroupsFollowing } from './mark-groups';

const mark = (id: string, over: Partial<Mark> = {}): Mark => ({ id, kind: 'picture', x: 10, y: 10, width: 50, height: 20, rotation: 0, stroke: null, fill: null, opacity: 1, lineWidth: 1, ...over });
const page = (key: string, marks?: Mark[]): PlanPage => ({ key, documentId: 1, page: 0, rotation: 0, width: 600, height: 800, marks });
let made = 0;
const newId = () => `new-${(made += 1)}`;

describe('repeatedOn', () => {
  it('puts a mark on other pages as one group, and keeps it where it is', () => {
    const plan = [page('a', [mark('s')]), page('b'), page('c', [mark('other')])];
    const changed = repeatedOn(plan, 'a', 's', [0, 1, 2], newId);
    const group = changed.get('a')?.[0]?.group;
    expect(group).toBeTruthy();
    expect(changed.get('b')).toMatchObject([{ x: 10, y: 10, group }]);
    expect(changed.get('c')).toHaveLength(2);
    expect(changed.get('c')?.[0]?.id).toBe('other');
  });

  it('takes it off the pages it is no longer wanted on', () => {
    const plan = [page('a', [mark('s', { group: 'g' })]), page('b', [mark('s2', { group: 'g' })]), page('c', [mark('s3', { group: 'g' })])];
    const changed = repeatedOn(plan, 'a', 's', [0, 2], newId);
    expect(changed.get('b')).toEqual([]);
    // A page that keeps its copy gets a fresh one, at the place of the one being repeated.
    expect(changed.get('c')).toHaveLength(1);
    expect(pagesOfGroup(plan, 'g')).toEqual([0, 1, 2]);
  });
});

describe('withGroupsFollowing', () => {
  it('moves the others of a group with the one that was moved', () => {
    const plan = [page('a', [mark('s', { group: 'g' }), mark('alone')]), page('b', [mark('s2', { group: 'g' })]), page('c', [mark('x')])];
    const moved = [mark('s', { group: 'g', x: 200, y: 300, rotation: 15 }), plan[0]?.marks?.[1] as Mark];
    const changed = withGroupsFollowing(plan, 'a', moved);
    expect(changed.get('b')).toMatchObject([{ id: 's2', group: 'g', x: 200, y: 300, rotation: 15 }]);
    expect(changed.has('c')).toBe(false);
  });

  it('changes one page only when nothing of a group changed', () => {
    const plan = [page('a', [mark('s', { group: 'g' })]), page('b', [mark('s2', { group: 'g' })])];
    // The mark of the group was deleted on this page: the other page keeps its own.
    const changed = withGroupsFollowing(plan, 'a', []);
    expect([...changed.keys()]).toEqual(['a']);
  });
});
