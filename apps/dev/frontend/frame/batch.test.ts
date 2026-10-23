import { describe, expect, it } from 'vitest';
import { addFiles, shownAsText, splitPath, totalsOf } from './batch';
import type { BatchItem, FoundFile } from './batch';

const file = (path: string): FoundFile => ({ path, root: null, size: 1 });
const item = (status: BatchItem['status'], bytesIn = 0, bytesOut = 0): BatchItem => ({ path: 'a', out: null, status, code: null, line: null, column: null, bytesIn, bytesOut, ms: 0 });

describe('addFiles', () => {
  it('takes each file once, in the order they were given', () => {
    const files = addFiles([file('a'), file('b')], [file('b'), file('c'), file('c')]);
    expect(files.map((found) => found.path)).toEqual(['a', 'b', 'c']);
  });
});

describe('totalsOf', () => {
  it('counts how the files came out and what was read and written', () => {
    expect(totalsOf([item('done', 10, 12), item('done', 5, 4), item('wrong'), item('skipped'), item('failed')])).toEqual({ done: 2, wrong: 1, skipped: 1, failed: 1, bytesIn: 15, bytesOut: 16 });
  });
});

describe('splitPath', () => {
  it('tells the folder from the name, whichever way the path is written', () => {
    expect(splitPath('C:\\data\\in\\a.json')).toEqual({ folder: 'C:\\data\\in', name: 'a.json' });
    expect(splitPath('/home/me/a.json')).toEqual({ folder: '/home/me', name: 'a.json' });
    expect(splitPath('a.json')).toEqual({ folder: '', name: 'a.json' });
  });
});

describe('shownAsText', () => {
  it('writes each digest as the checksum programs do, and a longer result under its file', () => {
    const done = (path: string, said: string | null): BatchItem => ({ ...item('done'), path, said });
    expect(shownAsText([done('/x/a.iso', 'ab12'), { ...item('failed'), path: 'b' }, done('c', null), done('d.bin', 'MD5: 1\nSHA-1: 2')])).toBe('ab12  /x/a.iso\nd.bin\nMD5: 1\nSHA-1: 2\n\n');
  });
});
