import { describe, expect, it } from 'vitest';
import type { PlanPage } from '../document/page-plan';
import type { Mark } from '../marks/mark';
import { batesNumber, filledText, pageTextMarks, startPageTexts } from './page-texts';

const pages: PlanPage[] = [0, 1, 2].map((page) => ({ key: `p${page}`, documentId: 1, page, rotation: 0, width: 600, height: 800 }));
const fitted = (mark: Mark): Mark => ({ ...mark, width: (mark.text ?? '').length * 5, height: 12 });

describe('page texts', () => {
  it('fills in the words in braces', () => {
    expect(filledText('{file} · {page}/{pages} · {date} · {other}', { page: 2, pages: 9, date: '10.10.2026', file: 'act.pdf' })).toBe('act.pdf · 2/9 · 10.10.2026 · {other}');
  });

  it('writes Bates numbers with zeros in front', () => {
    const bates = { prefix: 'SC-', suffix: '/A', start: 98, digits: 4, place: 'bottom-right' as const };
    expect(batesNumber(bates, 0)).toBe('SC-0098/A');
    expect(batesNumber(bates, 2)).toBe('SC-0100/A');
  });

  it('puts a header and a footer where their texts are', () => {
    const settings = { ...startPageTexts('header-footer', new Set()), texts: { ...startPageTexts('header-footer', new Set()).texts, 'top-left': '{file}', 'bottom-center': '{page} / {pages}' } };
    const marks = pageTextMarks(settings, pages, 1, '10.10.2026', 'act.pdf', fitted, 'h');
    expect(marks.map((mark) => mark.text)).toEqual(['act.pdf', '2 / 3']);
    // The header at the top left, the footer in the middle of the bottom.
    expect(marks[0]?.y).toBeLessThan(100);
    expect(marks[1]?.y).toBeGreaterThan(700);
    expect((marks[1]?.x ?? 0) + (marks[1]?.width ?? 0) / 2).toBeCloseTo(300);
  });

  it('counts Bates numbers over the pages that get one', () => {
    const settings = { ...startPageTexts('bates', new Set()), range: { kind: 'custom' as const, list: '2-3' } };
    expect(pageTextMarks(settings, pages, 0, '', '', fitted, 'b')).toEqual([]);
    expect(pageTextMarks(settings, pages, 2, '', '', fitted, 'b')[0]?.text).toBe('000002');
  });
});
