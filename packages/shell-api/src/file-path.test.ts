import { describe, expect, it } from 'vitest';
import { fileEnding, fileName, folderOf } from './file-path';

describe('file and folder names', () => {
  it('split Windows and Unix paths', () => {
    expect(fileName('C:\\Users\\me\\Documents\\lease.pdf')).toBe('lease.pdf');
    expect(folderOf('C:\\Users\\me\\Documents\\lease.pdf')).toBe('C:\\Users\\me\\Documents');
    expect(fileName('/home/me/lease.pdf')).toBe('lease.pdf');
    expect(folderOf('/home/me/lease.pdf')).toBe('/home/me');
    expect(fileName('C:/mixed\\path/list.txt')).toBe('list.txt');
  });

  it('take a bare name as a file in no folder', () => {
    expect(fileName('lease.pdf')).toBe('lease.pdf');
    expect(folderOf('lease.pdf')).toBe('');
  });

  it('read endings as they are written', () => {
    expect(fileEnding('C:\\x\\Report.PDF')).toBe('pdf');
    expect(fileEnding('a/b.c/d')).toBe('');
    expect(fileEnding('.gitignore')).toBe('');
    expect(fileEnding('X.TAR.GZ')).toBe('gz');
  });
});
