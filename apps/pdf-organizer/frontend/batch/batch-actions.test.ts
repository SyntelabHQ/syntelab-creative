import { describe, expect, it } from 'vitest';
import type { PlanPage } from '../document/page-plan';
import type { Mark } from '../marks/mark';
import { canBeOne, commonFolder, DEFAULT_JOB, defaultSuffix, inFolder, leavesPagesAlone, oneName, pagesAfter, resultEnding, resultNames, resultPaths, signatureBox, withStep, writeRequest } from './batch-actions';

const plan: PlanPage[] = [0, 1].map((page) => ({ key: `p${page}`, documentId: 3, page, rotation: page === 0 ? 0 : 270, width: 600, height: 800 }));
const fitted = (mark: Mark): Mark => ({ ...mark, width: 10, height: 12 });
const words = { page: 'Page {number}', pageOf: 'Page {number} of {count}' };
const tools = { words, fitted, sample: (text: string): Mark => fitted({ id: 's', kind: 'text', x: 0, y: 0, width: 0, height: 0, rotation: 0, stroke: '#c62828', fill: null, opacity: 1, lineWidth: 1, text, size: 100 }), scaled: (mark: Mark, width: number): Mark => ({ ...mark, width, height: (mark.height * width) / mark.width }), today: '10 Oct 2026', file: 'Act.pdf' };

describe('batch actions', () => {
  it('names each result after its file, and tells two of one name apart', () => {
    expect(resultNames(['C:\\a\\Act.pdf', 'D:/b/act.PDF', 'C:\\a\\Plan.final.docx'], '_small', 'pdf')).toEqual(['Act_small.pdf', 'act_small_2.pdf', 'Plan.final_small.pdf']);
    // What a file name cannot have is left out of what was typed.
    expect(resultNames(['a.pdf'], ' (copy: 2)/x', 'pdf')).toEqual(['a (copy 2)x.pdf']);
  });

  it('names the one file everything is gathered in', () => {
    expect(oneName(' Contracts: May.pdf ')).toBe('Contracts May.pdf');
    expect(oneName('')).toBe('syntelab-combined.pdf');
  });

  it('gives a signature its usual room, inside the page', () => {
    expect(signatureBox(600, 800, 'bottom-right')).toEqual({ x: 382, y: 708, width: 190, height: 64 });
    expect(signatureBox(600, 800, 'top-left')).toMatchObject({ x: 28, y: 28 });
    // A page too small for it gets a smaller one.
    const small = signatureBox(100, 60, 'bottom-center');
    expect(small.width).toBeLessThanOrEqual(100);
    expect(small.y + small.height).toBeLessThanOrEqual(60);
  });

  it('puts a result in its folder', () => {
    expect(inFolder('C:\\out\\', 'a.pdf')).toBe('C:\\out\\a.pdf');
    expect(inFolder('/home/ana/out', 'a.pdf')).toBe('/home/ana/out/a.pdf');
  });

  it('says where each result goes, in the folders under the chosen one too', () => {
    const under = new Map([['C:\\in\\b\\Two.pdf', 'b']]);
    expect(resultPaths(['C:\\in\\One.pdf', 'C:\\in\\b\\Two.pdf'], under, 'C:\\out', ['One.pdf', 'Two.pdf'])).toEqual(['C:\\out\\One.pdf', 'C:\\out\\b\\Two.pdf']);
  });

  it('finds the folder all the files come from', () => {
    expect(commonFolder(['C:\\Docs\\a.pdf', 'c:\\docs\\b.pdf'], new Map())).toBe('C:\\Docs');
    expect(commonFolder(['/home/ana/a.pdf', '/home/ana/x/b.pdf'], new Map())).toBeNull();
    // The files of an added folder come from it, whatever folder under it they lie in.
    expect(commonFolder(['/home/ana/a.pdf', '/home/ana/x/y/b.pdf'], new Map([['/home/ana/x/y/b.pdf', 'x/y']]))).toBe('/home/ana');
    expect(commonFolder([], new Map())).toBeNull();
  });

  it('keeps the steps in the order they are done, whatever order they were chosen in', () => {
    expect(withStep(withStep(['sign'], 'numbers', true), 'rotate', true)).toEqual(['rotate', 'numbers', 'sign']);
    expect(withStep(['numbers'], 'ocr', true)).toEqual(['ocr', 'numbers']);
    expect(withStep(['rotate', 'sign'], 'rotate', false)).toEqual(['sign']);
  });

  it('does not write another format together with what only a PDF can be given', () => {
    expect(withStep(['numbers', 'compress', 'sign'], 'export', true)).toEqual(['numbers', 'export']);
    expect(withStep(['numbers', 'export'], 'sign', true)).toEqual(['numbers', 'sign']);
    expect(canBeOne({ ...DEFAULT_JOB, steps: ['export'] })).toBe(false);
    expect(canBeOne(DEFAULT_JOB)).toBe(true);
  });

  it('adds to a name what the last step says', () => {
    expect(defaultSuffix(DEFAULT_JOB)).toBe('');
    expect(defaultSuffix({ ...DEFAULT_JOB, steps: ['rotate', 'numbers'] })).toBe('_numbered');
    expect(defaultSuffix({ ...DEFAULT_JOB, steps: ['numbers', 'compress', 'sign'] })).toBe('_signed');
    expect(defaultSuffix({ ...DEFAULT_JOB, steps: ['numbers', 'export'] })).toBe('');
    expect(defaultSuffix({ ...DEFAULT_JOB, steps: ['rotate', 'ocr'] })).toBe('_searchable');
  });

  it('turns every page', () => {
    const turned = pagesAfter({ ...DEFAULT_JOB, steps: ['rotate'], turn: 180 }, plan, tools);
    expect(turned.map((page) => page.rotation)).toEqual([180, 90]);
  });

  it('numbers every page, after turning it', () => {
    const numbered = pagesAfter({ ...DEFAULT_JOB, steps: ['rotate', 'numbers'], numberFormat: 'of' }, plan, tools);
    expect(numbered.map((page) => page.marks?.[0]?.text)).toEqual(['1 / 2', '2 / 2']);
    expect(numbered.map((page) => page.rotation)).toEqual([90, 0]);
  });

  it('writes a header and a footer on every page, with what the words in braces stand for', () => {
    const written = pagesAfter({ ...DEFAULT_JOB, steps: ['header'], headerText: '{file}', footerText: 'Page {page} of {pages}, {date}' }, plan, tools);
    expect(written.map((page) => page.marks?.map((mark) => mark.text))).toEqual([['Act.pdf', 'Page 1 of 2, 10 Oct 2026'], ['Act.pdf', 'Page 2 of 2, 10 Oct 2026']]);
    // Nothing typed: nothing written.
    expect(pagesAfter({ ...DEFAULT_JOB, steps: ['header'] }, plan, tools)).toEqual(plan);
  });

  it('writes words across every page, faint, upright for the reader of a turned page', () => {
    const marked = pagesAfter({ ...DEFAULT_JOB, steps: ['watermark'], watermarkText: 'DRAFT', watermarkAngle: 'straight' }, plan, tools);
    expect(marked.map((page) => page.marks?.[0]?.text)).toEqual(['DRAFT', 'DRAFT']);
    expect(marked[0]?.marks?.[0]?.opacity).toBeLessThan(0.5);
    expect(marked.map((page) => page.marks?.[0]?.rotation)).toEqual([0, 90]);
  });

  it('does what was chosen in its order: the header before the numbers', () => {
    const both = pagesAfter({ ...DEFAULT_JOB, steps: ['header', 'numbers'], headerText: 'Top' }, plan, tools);
    expect(both[0]?.marks?.map((mark) => mark.text)).toEqual(['Top', '1']);
  });

  it('leaves the pages as they are when nothing changes them', () => {
    expect(pagesAfter({ ...DEFAULT_JOB, steps: ['compress'] }, plan, tools)).toEqual(plan);
    expect(leavesPagesAlone({ ...DEFAULT_JOB, steps: ['sign'] })).toBe(true);
    expect(leavesPagesAlone({ ...DEFAULT_JOB, steps: ['compress', 'sign'] })).toBe(false);
    expect(leavesPagesAlone({ ...DEFAULT_JOB, steps: ['ocr', 'sign'] })).toBe(false);
  });

  it('asks for what each job writes', () => {
    expect(writeRequest({ ...DEFAULT_JOB, steps: ['compress'], level: 'strong' }, false)).toEqual({ command: 'save_pages', options: { keepExisting: true, shrinkPictures: { longestSide: 900, quality: 60 } } });
    expect(writeRequest(DEFAULT_JOB, false)).toEqual({ command: 'save_pages', options: { keepExisting: true } });
    // Asked to: a file already there is written over.
    expect(writeRequest(DEFAULT_JOB, true)).toEqual({ command: 'save_pages', options: { replace: true } });
    const exported = { ...DEFAULT_JOB, steps: ['export' as const], choice: { format: 'png' as const, resolution: 300, quality: 85 } };
    expect(writeRequest(exported, false)).toEqual({ command: 'export_document', options: { format: 'png', resolution: 300, keepExisting: true } });
    expect(writeRequest(exported, true)).toEqual({ command: 'export_document', options: { format: 'png', resolution: 300, replace: true } });
    expect(resultEnding(exported)).toBe('png');
    expect(resultEnding(DEFAULT_JOB)).toBe('pdf');
  });
});
