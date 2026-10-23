import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, heldWhole, indentAsked, readOptions, resultName, waysOf } from './json-options';

describe('readOptions', () => {
  it('keeps what is valid and mends the rest', () => {
    expect(readOptions({ mode: 'minify', indent: 'tab' })).toEqual({ ...DEFAULT_OPTIONS, mode: 'minify', indent: 'tab' });
    expect(readOptions({ indent: 'custom', spaces: 8 })).toEqual({ ...DEFAULT_OPTIONS, indent: 'custom', spaces: 8 });
    expect(readOptions({ indent: 'custom', spaces: 2.5 }).spaces).toBe(3);
    expect(readOptions({ indent: 'custom', spaces: 999 }).spaces).toBe(3);
    expect(readOptions({ mode: 'sort', indent: 3, sortKeys: 'yes', lineEnding: 'cr', change: 'shout' })).toEqual(DEFAULT_OPTIONS);
    expect(readOptions({ sortKeys: true, colonSpace: false, lineEnding: 'crlf', change: 'flatten' })).toEqual({ ...DEFAULT_OPTIONS, sortKeys: true, colonSpace: false, lineEnding: 'crlf', change: 'flatten' });
    expect(readOptions(undefined)).toEqual(DEFAULT_OPTIONS);
  });
});

describe('indentAsked', () => {
  it('is the number of spaces of the user when the indent is their own', () => {
    expect(indentAsked({ indent: 'custom', spaces: 0 })).toBe('0');
    expect(indentAsked({ indent: 'tab', spaces: 7 })).toBe('tab');
    expect(indentAsked({ indent: '4', spaces: 7 })).toBe('4');
  });
});

describe('waysOf', () => {
  it('says the options as the Rust side takes them', () => {
    expect(waysOf(DEFAULT_OPTIONS)).toEqual({ mode: 'format', indent: '2', lenient: false, colonSpace: true, lineEnding: 'lf', finalNewline: false, ascii: false, sortKeys: false, oneLineWithin: 0, change: '' });
    expect(waysOf({ ...DEFAULT_OPTIONS, oneLine: true, change: 'drop-nulls' })).toMatchObject({ oneLineWithin: 80, change: 'drop-nulls' });
  });
});

describe('heldWhole', () => {
  it('is true only for what cannot be done as the text goes by', () => {
    expect(heldWhole(DEFAULT_OPTIONS)).toBe(false);
    expect(heldWhole({ ...DEFAULT_OPTIONS, ascii: true, lenient: true, finalNewline: true, lineEnding: 'crlf', colonSpace: false })).toBe(false);
    expect(heldWhole({ ...DEFAULT_OPTIONS, sortKeys: true })).toBe(true);
    expect(heldWhole({ ...DEFAULT_OPTIONS, change: 'flatten' })).toBe(true);
    expect(heldWhole({ ...DEFAULT_OPTIONS, oneLine: true })).toBe(true);
    expect(heldWhole({ ...DEFAULT_OPTIONS, oneLine: true, mode: 'minify' })).toBe(false);
    expect(heldWhole({ ...DEFAULT_OPTIONS, sortKeys: true, mode: 'validate' })).toBe(false);
  });
});

describe('resultName', () => {
  it('is made from the name of the file that was opened', () => {
    expect(resultName('data.json', 'format')).toBe('data.formatted.json');
    expect(resultName('archive.2026.json', 'minify')).toBe('archive.2026.min.json');
    expect(resultName('notes', 'format')).toBe('notes.formatted.json');
    expect(resultName(null, 'minify')).toBe('min.json');
  });
});
