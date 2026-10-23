import { describe, expect, it } from 'vitest';
import { mergeChangelogs, parseChangelog } from './changelog-entries';

const item = (id: string, date: string, title = id) => ({ id, date, title, body: 'text' });

describe('parseChangelog', () => {
  it('keeps well-formed items, newest first, with their texts filed under the language of the file', () => {
    const file = { items: [item('a', '2026-01-01'), { ...item('b', '2026-03-01'), link: 'https://syntelab.com', linkLabel: 'More' }] };
    const entries = parseChangelog(file, 'ro');
    expect(entries.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(entries[0]).toEqual({ id: 'b', date: '2026-03-01', title: { ro: 'b' }, body: { ro: 'text' }, link: 'https://syntelab.com', linkLabel: { ro: 'More' } });
  });

  it('leaves out anything malformed', () => {
    const file = { items: [item('a', '2026-01-01'), { id: 'x' }, null, { ...item('y', '2026-01-02'), title: { en: 'not plain' } }] };
    expect(parseChangelog(file, 'en').map((entry) => entry.id)).toEqual(['a']);
    expect(parseChangelog(null, 'en')).toEqual([]);
    expect(parseChangelog({ items: 'no' }, 'en')).toEqual([]);
  });
});

describe('mergeChangelogs', () => {
  it('joins the languages of an item and lets the newer list win', () => {
    const shipped = mergeChangelogs(parseChangelog({ items: [item('a', '2026-01-01', 'vechi')] }, 'ro'), parseChangelog({ items: [item('a', '2026-01-01', 'old'), item('b', '2026-02-01')] }, 'en'));
    const merged = mergeChangelogs(parseChangelog({ items: [item('a', '2026-01-01', 'nou'), item('c', '2026-05-01')] }, 'ro'), shipped);
    expect(merged.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
    expect(merged.find((entry) => entry.id === 'a')?.title).toEqual({ en: 'old', ro: 'nou' });
  });
});
