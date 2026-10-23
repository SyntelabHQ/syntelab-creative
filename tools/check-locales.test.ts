import { describe, expect, it } from 'vitest';
import { compareIcuMessages, duplicateKeys, manualPrefixMatches, emptyManualStrings } from './check-locales.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

describe('localization validation helpers', () => {
  it('finds empty manual content inside nested blocks', () => {
    expect(emptyManualStrings({ title: 'Manual', chapters: [{ body: ['Text', { note: '  ' }] }] }))
      .toEqual(['/chapters/0/body/1/note']);
  });

  it('checks completed languages without rewriting progress or its report', () => {
    const paths = ['docs/localization/progress.json', 'docs/localization/PROGRESS.md'];
    const before = paths.map(path => readFileSync(path, 'utf8'));
    execFileSync(process.execPath, ['tools/check-locales.mjs', '--completed']);
    expect(paths.map(path => readFileSync(path, 'utf8'))).toEqual(before);
  });

  it('does not allow a partial file check to mark a language complete', () => {
    const before = readFileSync('docs/localization/progress.json', 'utf8');
    const result = spawnSync(process.execPath, ['tools/check-locales.mjs', '--language=ro', '--partial', '--mark-complete']);
    expect(result.status).toBe(2);
    expect(readFileSync('docs/localization/progress.json', 'utf8')).toBe(before);
  });
  it('finds duplicate object keys before JSON.parse can discard one', () => {
    expect(duplicateKeys('{"outer":{"name":"one","name":"two"}}')).toEqual([
      { key: 'name', at: '/outer' },
    ]);
  });

  it('rejects changed ICU arguments and invalid ICU syntax', () => {
    expect(compareIcuMessages('Hello {name}', 'Hola {nombre}', 'es')).toContain(
      'ICU argument {name} expected argument, got missing',
    );
    expect(compareIcuMessages('{n, plural, one {# file} other {# files}}', '{n, plural, one {# archivo}}', 'es').join(' '))
      .toMatch(/other|invalid ICU message/);
    expect(compareIcuMessages('Hello {name}', 'Hello {name', 'es')[0]).toMatch(/invalid ICU message/);
  });

  it('accepts a translated manual prefix while preserving IDs and block structure', () => {
    const source = { title: 'Manual', chapters: [{ title: 'First', topics: [
      { id: 'one', title: 'Topic', body: ['Text', { note: 'Note' }] },
      { id: 'two', title: 'Next', body: ['More'] },
    ] }, { title: 'Second', topics: [] }] };
    const partial = { title: 'Руководство', chapters: [{ title: 'Первый', topics: [
      { id: 'one', title: 'Тема', body: ['Текст', { note: 'Примечание' }] },
    ] }] };
    expect(manualPrefixMatches(source, partial)).toBe(true);
    expect(manualPrefixMatches(source, { ...partial, chapters: [{
      ...partial.chapters[0], topics: [{ ...partial.chapters[0].topics[0], id: 'changed' }],
    }] })).toBe(false);
    expect(manualPrefixMatches(source, { ...partial, chapters: [{
      ...partial.chapters[0], topics: [{ ...partial.chapters[0].topics[0], body: ['Текст'] }],
    }] })).toBe(false);
  });
});
