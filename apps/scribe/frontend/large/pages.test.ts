import { describe, expect, it } from 'vitest';
import { PAGE_LINES, pageOf, pagesOf, sizeText } from './pages';

describe('the pages of a large file', () => {
  it('hold so many lines each', () => {
    expect(pageOf(1)).toBe(0);
    expect(pageOf(PAGE_LINES)).toBe(0);
    expect(pageOf(PAGE_LINES + 1)).toBe(1);
    expect(pageOf(0)).toBe(0);
    expect(pagesOf(0)).toBe(1);
    expect(pagesOf(PAGE_LINES)).toBe(1);
    expect(pagesOf(PAGE_LINES + 1)).toBe(2);
  });

  it('say the size of the file as people read it', () => {
    expect(sizeText(3 * 1024, 'en')).toBe('3 kB');
    expect(sizeText(512 * 1024 * 1024, 'en')).toBe('512 MB');
    expect(sizeText(1.5 * 1024 * 1024 * 1024, 'en')).toBe('1.5 GB');
    expect(sizeText(1.5 * 1024 * 1024 * 1024, 'ro')).toBe('1,5 GB');
  });
});
