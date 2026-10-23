import { describe, expect, it } from 'vitest';
import { pushHistory, redo, startHistory, undo } from './history';
import {
  deletePages,
  everySecondPage,
  insertPages,
  movePages,
  planFromDocument,
  rotatePages,
  samePlan,
  shownSizes,
  withDocumentId,
} from './page-plan';

// Five pages of document 7; page n is (100+n) × 200.
const plan = planFromDocument(7, [100, 200, 101, 200, 102, 200, 103, 200, 104, 200]);
const order = (pages: readonly { page: number }[]) => pages.map((page) => page.page);

describe('planFromDocument', () => {
  it('lists the pages of the file in order, unturned', () => {
    expect(order(plan)).toEqual([0, 1, 2, 3, 4]);
    expect(plan[2]).toEqual({ key: '7:2', documentId: 7, page: 2, rotation: 0, width: 102, height: 200 });
  });
});

describe('rotatePages and shownSizes', () => {
  it('turns only the chosen pages, and wraps around', () => {
    const turned = rotatePages(plan, new Set([0]), -90);
    expect(turned[0]?.rotation).toBe(270);
    expect(turned[1]?.rotation).toBe(0);
    expect(rotatePages(turned, new Set([0]), 90)[0]?.rotation).toBe(0);
  });

  it('swaps width and height when the total turn is sideways', () => {
    const turned = rotatePages(plan, new Set([0]), 90);
    expect(shownSizes(turned, 0).slice(0, 4)).toEqual([200, 100, 101, 200]);
    // The whole view turned too: the first page is upright again, the second sideways.
    expect(shownSizes(turned, 90).slice(0, 4)).toEqual([100, 200, 200, 101]);
  });
});

describe('deletePages', () => {
  it('removes the chosen pages', () => {
    expect(order(deletePages(plan, new Set([1, 3])))).toEqual([0, 2, 4]);
  });

  it('never leaves a document without pages', () => {
    expect(order(deletePages(plan, new Set([0, 1, 2, 3, 4])))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('movePages', () => {
  it('moves pages forward and back, keeping their order', () => {
    const forward = movePages(plan, new Set([0, 1]), 4);
    expect(order(forward.plan)).toEqual([2, 3, 0, 1, 4]);
    expect([...forward.chosen]).toEqual([2, 3]);

    const back = movePages(plan, new Set([3, 4]), 1);
    expect(order(back.plan)).toEqual([0, 3, 4, 1, 2]);
    expect([...back.chosen]).toEqual([1, 2]);
  });

  it('moves to the very end, and gathers scattered pages', () => {
    expect(order(movePages(plan, new Set([0]), 5).plan)).toEqual([1, 2, 3, 4, 0]);
    expect(order(movePages(plan, new Set([0, 2, 4]), 2).plan)).toEqual([1, 0, 2, 4, 3]);
  });

  it('changes nothing when dropped on itself', () => {
    expect(order(movePages(plan, new Set([2]), 2).plan)).toEqual([0, 1, 2, 3, 4]);
    expect(order(movePages(plan, new Set([2]), 3).plan)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('insertPages', () => {
  it('puts pages of another document where asked', () => {
    const other = planFromDocument(9, [50, 50, 60, 60]);
    const result = insertPages(plan, 2, other);
    expect(result.map((page) => page.key)).toEqual(['7:0', '7:1', '9:0', '9:1', '7:2', '7:3', '7:4']);
  });
});

describe('everySecondPage', () => {
  it('counts pages the way people do, from 1', () => {
    expect([...everySecondPage(5, 'odd')]).toEqual([0, 2, 4]);
    expect([...everySecondPage(5, 'even')]).toEqual([1, 3]);
  });
});

describe('samePlan', () => {
  it('notices a turn, a move and a removal', () => {
    expect(samePlan(plan, [...plan])).toBe(true);
    expect(samePlan(plan, rotatePages(plan, new Set([0]), 90))).toBe(false);
    expect(samePlan(plan, movePages(plan, new Set([0]), 2).plan)).toBe(false);
    expect(samePlan(plan, deletePages(plan, new Set([0])))).toBe(false);
  });
});

describe('withDocumentId', () => {
  it('moves the pages of one document to its new id and leaves the others', () => {
    const mixed = insertPages(rotatePages(plan, new Set([0]), 90), 1, planFromDocument(9, [50, 50]));
    const moved = withDocumentId(mixed, 7, 12);
    expect(moved.map((page) => page.key)).toEqual(['12:0', '9:0', '12:1', '12:2', '12:3', '12:4']);
    expect(moved[0]?.rotation).toBe(90);
  });
});

describe('history', () => {
  it('undoes and redoes, and forgets the redo after a new step', () => {
    let history = startHistory('a');
    history = pushHistory(history, 'b');
    history = pushHistory(history, 'c');
    history = undo(history);
    expect(history.present).toBe('b');
    history = redo(history);
    expect(history.present).toBe('c');
    history = pushHistory(undo(undo(history)), 'x');
    expect(history.present).toBe('x');
    expect(redo(history).present).toBe('x');
    expect(undo(undo(undo(history))).present).toBe('a');
  });
});
