import { describe, expect, it } from 'vitest';
import { hasText, hiddenTextMark, languageName, startLanguages } from './ocr-words';

describe('reading scanned pages', () => {
  it('starts with the languages chosen the last time, as far as the engine has them', () => {
    expect(startLanguages(['eng', 'ron', 'deu'], ['deu', 'fra'], 'ro')).toEqual(['deu']);
  });

  it('else starts with the language of the program and English', () => {
    expect(startLanguages(['deu', 'eng', 'ron'], [], 'ro')).toEqual(['ron', 'eng']);
    expect(startLanguages(['eng'], [], 'ro')).toEqual(['eng']);
    expect(startLanguages(['eng', 'ron'], [], 'en-GB')).toEqual(['eng']);
    // An engine with neither still reads in what it has.
    expect(startLanguages(['jpn', 'kor'], [], 'ro')).toEqual(['jpn']);
    expect(startLanguages([], [], 'ro')).toEqual([]);
  });

  it('names the languages of the engine for the reader', () => {
    expect(languageName('ron', 'en')).toBe('Romanian');
    // One the list does not know keeps the name the engine gives it.
    expect(languageName('frk', 'en')).toBe('frk');
  });

  it('tells a page with text of its own from a scan', () => {
    expect(hasText('  \n 3 ')).toBe(false);
    expect(hasText('Primirea unei cereri pentru o marcă')).toBe(true);
  });

  it('makes the words a mark of the whole page, turned as the page was read', () => {
    const page = { key: 'p', documentId: 1, page: 0, rotation: 90 as const, width: 600, height: 800 };
    const mark = hiddenTextMark(page, [{ text: 'Act', x: 10, y: 20, width: 30, height: 12 }], 'm');
    expect(mark).toMatchObject({ kind: 'hiddenText', width: 600, height: 800, turn: 90 });
    expect(mark.words).toHaveLength(1);
  });
});
