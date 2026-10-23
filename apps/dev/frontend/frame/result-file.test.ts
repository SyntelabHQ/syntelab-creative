import { describe, expect, it } from 'vitest';
import { fileRunsByItself, FILE_RUN_BY_ITSELF_UP_TO, hexLines, shownOf } from './result-file';

describe('shownOf', () => {
  it('shows a text whole, the start of a very large one, and bytes as bytes', () => {
    expect(shownOf({ name: 'r', size: 5, text: 'hello' })).toEqual({ as: 'text', text: 'hello', size: 5 });
    expect(shownOf({ name: 'r', size: 20_000_000, large: true, head: '{"a"' })).toEqual({ as: 'start', text: '{"a"', size: 20_000_000 });
    expect(shownOf({ name: 'r', size: 67, large: true, binary: true, head: '' })).toEqual({ as: 'bytes', size: 67 });
    // An empty result is an empty text.
    expect(shownOf({ name: 'r', size: 0, text: '' })).toEqual({ as: 'text', text: '', size: 0 });
  });
});

describe('fileRunsByItself', () => {
  it('runs a file by itself up to a size, and leaves a larger one to Run', () => {
    expect(fileRunsByItself(0)).toBe(true);
    expect(fileRunsByItself(FILE_RUN_BY_ITSELF_UP_TO)).toBe(true);
    expect(fileRunsByItself(FILE_RUN_BY_ITSELF_UP_TO + 1)).toBe(false);
  });
});

describe('hexLines', () => {
  it('writes the first bytes sixteen to a line, each line led by where it starts', () => {
    const start = Array.from({ length: 20 }, (_, index) => index.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    expect(hexLines(start)).toEqual(['00000000  00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F', '00000010  10 11 12 13']);
    expect(hexLines('')).toEqual([]);
  });
});
