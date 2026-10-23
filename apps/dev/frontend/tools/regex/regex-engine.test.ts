import { describe, expect, it } from 'vitest';
import { runRegex } from './regex-engine';

const matches = (pattern: string, flags: string, text: string) => {
  const answer = runRegex({ pattern, flags, text, replacement: null });
  if (!answer.ok) throw new Error(answer.detail);
  return answer.matches;
};

describe('runRegex', () => {
  it('lists every match with its groups and its place', () => {
    const found = matches('(\\w+)@(\\w+)\\.com', 'g', 'ana@one.com\n  bo@two.com');
    expect(found).toEqual([
      { index: 0, end: 11, line: 1, column: 1, match: 'ana@one.com', groups: ['ana', 'one'] },
      { index: 14, end: 24, line: 2, column: 3, match: 'bo@two.com', groups: ['bo', 'two'] },
    ]);
  });

  it('looks for the first match only without the g flag', () => {
    expect(matches('a', '', 'banana')).toHaveLength(1);
    expect(matches('A', 'gi', 'banana')).toHaveLength(3);
  });

  it('tells named groups and groups that took no part', () => {
    const [found] = matches('(?<year>\\d{4})-(?<month>\\d{2})|(x)', 'g', 'on 2026-10');
    expect(found?.named).toEqual({ year: '2026', month: '10' });
    expect(found?.groups).toEqual(['2026', '10', null]);
  });

  it('never stands still on a pattern that matches nothing', () => {
    expect(matches('x*', 'g', 'ab').map((found) => found.index)).toEqual([0, 1, 2]);
    // With u a letter of two units is passed whole, as matchAll does: else the engine goes back to its start for ever.
    expect(matches('x*', 'gu', '😀a').map((found) => found.index)).toEqual([0, 2, 3]);
    expect(matches('x*', 'g', '😀').map((found) => found.index)).toEqual([0, 1, 2]);
    expect(matches('^', 'gm', 'a\nb').map((found) => [found.line, found.column])).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it('counts places as JavaScript does, and lines across many matches', () => {
    const found = matches('b', 'g', '😀b\n\nab');
    expect(found.map((one) => [one.index, one.line, one.column])).toEqual([
      [2, 1, 3],
      [6, 3, 2],
    ]);
  });

  it('replaces, with the groups the replacement names', () => {
    expect(runRegex({ pattern: '(\\w+)@(\\w+)', flags: 'g', text: 'ana@one bo@two', replacement: '$2:$1' })).toEqual({ ok: true, matches: [], replaced: 'one:ana two:bo' });
    expect(runRegex({ pattern: 'a', flags: '', text: 'aa', replacement: '' })).toEqual({ ok: true, matches: [], replaced: 'a' });
  });

  it('tells a pattern or a flag the engine does not take', () => {
    expect(runRegex({ pattern: '(', flags: '', text: '', replacement: null }).ok).toBe(false);
    expect(runRegex({ pattern: 'a', flags: 'q', text: '', replacement: null }).ok).toBe(false);
  });
});
