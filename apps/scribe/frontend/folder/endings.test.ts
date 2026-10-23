import { describe, expect, it } from 'vitest';
import { endingsOf } from './endings';

describe('endingsOf', () => {
  it('reads endings however they are typed', () => {
    expect(endingsOf('txt, .md; *.CSV  log')).toEqual(['txt', 'md', 'csv', 'log']);
    expect(endingsOf('txt, TXT, .txt')).toEqual(['txt']);
  });

  it('gives none for every file', () => {
    expect(endingsOf('')).toEqual([]);
    expect(endingsOf(' , * ')).toEqual([]);
  });
});
