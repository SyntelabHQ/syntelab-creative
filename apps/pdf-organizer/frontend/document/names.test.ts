import { describe, expect, it } from 'vitest';
import { extractedEachName, extractedName, fillName, newDocumentName, withoutExtension } from './names';

describe('names of documents the program makes', () => {
  it('names extracted pages after the document they come from', () => {
    expect(extractedName('pages_of_{name}', 'Report 2026.pdf')).toBe('pages_of_Report 2026.pdf');
    expect(extractedEachName('page{number}_of_{name}', 'Report.PDF', 3)).toBe('page03_of_Report.pdf');
    expect(extractedEachName('page{number}_of_{name}', 'Report.pdf', 120)).toBe('page120_of_Report.pdf');
  });

  it('counts new documents with five digits', () => {
    expect(newDocumentName('syntelab_pdf_{number}', 1)).toBe('syntelab_pdf_00001.pdf');
    expect(newDocumentName('syntelab_pdf_{number}', 123456)).toBe('syntelab_pdf_123456.pdf');
  });

  it('never gives a name the system refuses', () => {
    expect(fillName('a/b:c*{name}', { name: 'x?y' }, 2)).toBe('a_b_c_x_y.pdf');
    expect(fillName('  ', {}, 2)).toBe('document.pdf');
    expect(fillName('{name}. ', { name: 'draft' }, 2)).toBe('draft.pdf');
  });

  it('takes the ending off a file name', () => {
    expect(withoutExtension('a.b.pdf')).toBe('a.b');
    expect(withoutExtension('photo.JPEG')).toBe('photo');
    expect(withoutExtension('.hidden')).toBe('.hidden');
  });
});
