import { describe, expect, it } from 'vitest';
import { reportName, reportText } from './batch-report';
import type { Outcome } from './use-batch-run';

const words = { title: 'Batch processing', done: 'Done to each file', folder: 'Results in', written: 'Written', failed: 'Not done', notReached: 'Not reached', problem: (key: string) => `<${key}>` };

describe('batch report', () => {
  it('says for each file what was written or why nothing was', () => {
    const outcomes = new Map<string, Outcome>([
      ['C:\\in\\a.pdf', { state: 'done', name: 'a_signed.pdf' }],
      ['C:\\in\\b.docx', { state: 'failed', problem: 'needs-office' }],
      ['C:\\in\\c.pdf', { state: 'waiting' }],
    ]);
    const text = reportText(['C:\\in\\a.pdf', 'C:\\in\\b.docx', 'C:\\in\\c.pdf'], outcomes, { moment: '10 Oct 2026, 17:00', steps: 'Sign', folder: 'C:\\out' }, words);
    expect(text.split('\r\n')).toEqual([
      'Batch processing — 10 Oct 2026, 17:00',
      'Done to each file: Sign',
      'Results in: C:\\out',
      'Written: 1    Not done: 1    Not reached: 1',
      '',
      'C:\\in\\a.pdf',
      '    Written: a_signed.pdf',
      'C:\\in\\b.docx',
      '    Not done: <needs-office>',
      'C:\\in\\c.pdf',
      '    Not reached',
      '',
    ]);
  });

  it('names a report by the moment it was made', () => {
    expect(reportName(new Date(2026, 9, 10, 7, 5, 9))).toBe('batch-report_2026-10-10_070509.txt');
  });
});
