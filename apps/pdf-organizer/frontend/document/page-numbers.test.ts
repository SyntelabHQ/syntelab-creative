import { describe, expect, it } from 'vitest';
import type { Mark } from '../marks/mark';
import { DEFAULT_NUMBERING, numberMark, numberOfPage, pageNumber } from './page-numbers';
import type { PlanPage } from './page-plan';

const words = { page: 'Page {number}', pageOf: 'Page {number} of {count}' };
const page = (rotation: PlanPage['rotation'] = 0): PlanPage => ({ key: 'p', documentId: 1, page: 0, rotation, width: 600, height: 800 });
// A text 40 points wide, whatever it says.
const fitted = (mark: Mark): Mark => ({ ...mark, width: 40, height: (mark.size ?? 0) * 1.25 });

describe('page numbers', () => {
  it('writes a number in each format', () => {
    expect(pageNumber('plain', 3, 12, words)).toBe('3');
    expect(pageNumber('of', 3, 12, words)).toBe('3 / 12');
    expect(pageNumber('dashes', 3, 12, words)).toBe('– 3 –');
    expect(pageNumber('page', 3, 12, words)).toBe('Page 3');
    expect(pageNumber('page-of', 3, 12, words)).toBe('Page 3 of 12');
    expect(pageNumber('custom', 3, 12, words, 'Sheet {number} / {count} — draft')).toBe('Sheet 3 / 12 — draft');
    expect(pageNumber('custom', 3, 12, words, 'No number here')).toBe('No number here');
  });

  it('numbers a page by its place in the document, from where asked', () => {
    const numbering = { ...DEFAULT_NUMBERING, format: 'of' as const, start: 7 };
    expect(numberOfPage(numbering, 0, 3, words)).toBe('7 / 9');
    expect(numberOfPage(numbering, 2, 3, words)).toBe('9 / 9');
  });

  it('can leave the first page without a number; the others keep theirs', () => {
    const numbering = { ...DEFAULT_NUMBERING, skipFirst: true };
    expect(numberOfPage(numbering, 0, 5, words)).toBeNull();
    expect(numberOfPage(numbering, 1, 5, words)).toBe('2');
  });

  it('starts at the bottom right', () => {
    expect(DEFAULT_NUMBERING.place).toBe('bottom-right');
  });
});

describe('numberMark', () => {
  const numbering = { ...DEFAULT_NUMBERING, size: 10, margin: 20 };

  it('stands a margin away from the edges of its corner', () => {
    const mark = numberMark(page(), '3', numbering, fitted, 'n');
    expect(mark).toMatchObject({ kind: 'text', text: '3', x: 540, y: 767.5, rotation: 0, stroke: '#000000' });
    const top = numberMark(page(), '3', { ...numbering, place: 'top-center' }, fitted, 'n');
    expect(top).toMatchObject({ x: 280, y: 20 });
  });

  it('stands at the same place for the reader on a page the user turned', () => {
    // Turned a quarter clockwise, the page is shown 800 wide and 600 tall.
    const mark = numberMark(page(90), '3', numbering, fitted, 'n');
    expect(mark.rotation).toBe(270);
    // Its middle as shown is 40 from the right edge and 26.25 from the bottom; in the page as its file has it:
    const middle = { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 };
    expect(middle).toEqual({ x: 573.75, y: 40 });
  });
});
