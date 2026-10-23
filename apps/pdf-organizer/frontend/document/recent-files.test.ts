import { describe, expect, it } from 'vitest';
import { withRecentFile } from './recent-files';

describe('withRecentFile', () => {
  it('puts the file first and keeps each file once', () => {
    const files = withRecentFile(
      [
        { path: 'C:\\a.pdf', openedAt: 1 },
        { path: 'C:\\b.pdf', openedAt: 2 },
      ],
      'C:\\b.pdf',
      3,
    );
    expect(files).toEqual([
      { path: 'C:\\b.pdf', openedAt: 3 },
      { path: 'C:\\a.pdf', openedAt: 1 },
    ]);
  });

  it('keeps the list short', () => {
    let files = withRecentFile([], 'first.pdf', 0);
    for (let index = 1; index <= 30; index++) files = withRecentFile(files, `file-${index}.pdf`, index);
    expect(files).toHaveLength(12);
    expect(files[0]?.path).toBe('file-30.pdf');
  });
});
