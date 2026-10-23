import { describe, expect, it } from 'vitest';
import shellEnglish from '../../../help/shell/en.json';
import shellRomanian from '../../../help/shell/ro.json';
import organizerEnglish from '../../../apps/pdf-organizer/help/en.json';
import organizerRomanian from '../../../apps/pdf-organizer/help/ro.json';
import { parseManual, searchManuals } from './manual';

const file = {
  title: 'Test',
  chapters: [
    {
      title: 'Signing',
      topics: [
        { id: 'sign', title: 'Semnătură cu certificat', body: ['Choose a certificate.', { steps: ['Open Sign', 'Drag on the page'] }, { note: 'A token asks for its PIN.' }, { nothing: true }, ''] },
        { id: 'sign', title: 'Twice', body: ['The same id again.'] },
        { id: 'empty', title: 'No text', body: [] },
      ],
    },
    { title: 'Pages', topics: [{ id: 'rotate', title: 'Rotate pages', body: [{ points: ['Left', 'Right'] }, 'A certificate is not needed.'] }] },
    { title: 'Broken' },
  ],
};

describe('manual', () => {
  it('reads what is well formed and leaves out the rest', () => {
    const manual = parseManual('test', file);
    expect(manual?.chapters.map((chapter) => chapter.topics.map((topic) => topic.id))).toEqual([['sign'], ['rotate']]);
    expect(manual?.chapters[0]?.topics[0]?.body).toHaveLength(3);
    expect(parseManual('test', { title: 'Nothing', chapters: [] })).toBeNull();
    expect(parseManual('test', 'text')).toBeNull();
  });

  it('finds topics by every word typed, whatever the accents, titles first', () => {
    const manual = parseManual('test', file);
    const manuals = manual ? [manual] : [];
    expect(searchManuals(manuals, 'SEMNATURA').map((found) => found.topic.id)).toEqual(['sign']);
    // In the title of one, in the text of the other: the title comes first.
    expect(searchManuals(manuals, 'certificate').map((found) => found.topic.id)).toEqual(['sign', 'rotate']);
    expect(searchManuals(manuals, 'pin token').map((found) => found.topic.id)).toEqual(['sign']);
    expect(searchManuals(manuals, 'pin rotate')).toEqual([]);
    expect(searchManuals(manuals, '  ')).toEqual([]);
  });

  it('ships manuals that are whole, with the same topics in every language', () => {
    const ids = (id: string, source: unknown) => {
      const manual = parseManual(id, source);
      expect(manual, `${id} is readable`).not.toBeNull();
      // Nothing was left out: every topic of the file is in the manual read from it.
      const written = (source as { chapters: { topics: unknown[] }[] }).chapters.flatMap((chapter) => chapter.topics).length;
      const read = manual?.chapters.flatMap((chapter) => chapter.topics.map((topic) => topic.id)) ?? [];
      expect(read).toHaveLength(written);
      return read;
    };
    expect(ids('shell', shellRomanian)).toEqual(ids('shell', shellEnglish));
    expect(ids('pdf-organizer', organizerRomanian)).toEqual(ids('pdf-organizer', organizerEnglish));
  });
});
