import { describe, expect, it } from 'vitest';
import { canBeFollowed, linksOfAnswer } from './page-links';

describe('canBeFollowed', () => {
  it('follows web pages and mail', () => {
    expect(canBeFollowed('https://syntelab.com')).toBe(true);
    expect(canBeFollowed('HTTP://example.org/a')).toBe(true);
    expect(canBeFollowed('mailto:ana@syntelab.com')).toBe(true);
  });

  it('does not follow files, scripts or anything else', () => {
    expect(canBeFollowed('file:///C:/Windows/system32/calc.exe')).toBe(false);
    expect(canBeFollowed('javascript:alert(1)')).toBe(false);
    expect(canBeFollowed('C:\\notes.txt')).toBe(false);
  });
});

describe('linksOfAnswer', () => {
  it('puts the signatures of a page first, and says which each is', () => {
    const links = linksOfAnswer({
      links: [{ x: 1, y: 2, width: 3, height: 4, url: 'https://syntelab.com', page: null }],
      signatures: [{ x: 10, y: 20, width: 30, height: 40, index: 2 }],
    });
    expect(links).toEqual([
      { x: 10, y: 20, width: 30, height: 40, url: null, page: null, signature: 2 },
      { x: 1, y: 2, width: 3, height: 4, url: 'https://syntelab.com', page: null, signature: null },
    ]);
  });

  it('reads an answer without signatures', () => {
    expect(linksOfAnswer({ links: [] })).toEqual([]);
  });
});
