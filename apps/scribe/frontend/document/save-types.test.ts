import { describe, expect, it } from 'vitest';
import { documentFormat, saveTypes } from './save-types';

describe('save types', () => {
  it('starts with the type of the file, and keeps an ending it does not know under All files', () => {
    expect(saveTypes('md', (id) => id)[0]).toEqual({ name: 'markdown', extensions: ['md', 'markdown'] });
    expect(saveTypes('py', (id) => id)[0]).toEqual({ name: 'all', extensions: ['*'] });
    expect(saveTypes('txt', (id) => id).map((type) => type.name)).toContain('pdf');
  });

  it('knows a Word document and a PDF by their ending', () => {
    expect(documentFormat('C:\\a\\Note.DOCX')).toBe('docx');
    expect(documentFormat('/home/a/note.pdf')).toBe('pdf');
    expect(documentFormat('note.txt')).toBeNull();
    expect(documentFormat('pdf')).toBeNull();
  });
});
