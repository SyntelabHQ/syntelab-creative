import type { PlanPage } from '../document/page-plan';
import type { Mark } from './mark';

/**
 * Marks that are the same thing on several pages (a signature put on every
 * page, a stamp): they carry the same `group`, and what is done to one is
 * done to all of them.
 */

/** What is carried over from a changed mark to the others of its group: where it is and how it looks. */
function carried(mark: Mark): Partial<Mark> {
  const { id: _id, group: _group, ...rest } = mark;
  return rest;
}

/**
 * The marks of every page after the page with `pageKey` got `marks`: a mark
 * of a group that was moved, resized, turned or restyled there takes the
 * others of its group along, on their pages. (A mark deleted on one page is
 * only gone from that page.) Returns, by page key, the marks of the pages
 * that change.
 */
export function withGroupsFollowing(plan: readonly PlanPage[], pageKey: string, marks: readonly Mark[]): Map<string, readonly Mark[]> {
  const changedPage = plan.find((page) => page.key === pageKey);
  const before = new Map((changedPage?.marks ?? []).map((mark) => [mark.id, mark]));
  const leaders = new Map<string, Mark>();
  for (const mark of marks) {
    if (mark.group && before.has(mark.id) && before.get(mark.id) !== mark) leaders.set(mark.group, mark);
  }
  const changed = new Map<string, readonly Mark[]>([[pageKey, marks]]);
  if (leaders.size === 0) return changed;
  for (const page of plan) {
    if (page.key === pageKey || !page.marks?.some((mark) => mark.group && leaders.has(mark.group))) continue;
    changed.set(
      page.key,
      page.marks.map((mark) => (mark.group && leaders.has(mark.group) ? { ...mark, ...carried(leaders.get(mark.group) as Mark) } : mark)),
    );
  }
  return changed;
}

/**
 * The marks of every page after the mark `markId` of the page `pageKey` was
 * put on the pages at `indexes` as well (and taken off every other page it
 * was repeated on). The mark itself stays where it is.
 */
export function repeatedOn(plan: readonly PlanPage[], pageKey: string, markId: string, indexes: readonly number[], newId: () => string): Map<string, readonly Mark[]> {
  const changed = new Map<string, readonly Mark[]>();
  const origin = plan.find((page) => page.key === pageKey);
  const mark = origin?.marks?.find((candidate) => candidate.id === markId);
  if (!origin || !mark) return changed;
  const group = mark.group ?? newId();
  plan.forEach((page, index) => {
    const others = (page.marks ?? []).filter((candidate) => candidate.group !== group || candidate.id === markId);
    const here = page.key === pageKey;
    const wanted = !here && indexes.includes(index);
    const next = here ? others.map((candidate) => (candidate.id === markId ? { ...candidate, group } : candidate)) : wanted ? [...others, { ...mark, id: newId(), group }] : others;
    if (here || wanted || next.length !== (page.marks ?? []).length) changed.set(page.key, next);
  });
  return changed;
}

/** The places (from 0) of the pages that have a mark of this group. */
export function pagesOfGroup(plan: readonly PlanPage[], group: string | undefined): number[] {
  if (!group) return [];
  return plan.flatMap((page, index) => (page.marks?.some((mark) => mark.group === group) ? [index] : []));
}
