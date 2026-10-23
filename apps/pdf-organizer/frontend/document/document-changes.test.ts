import { describe, expect, it } from 'vitest';
import { bookmarkEdit, hasChanges, NO_CHANGES, withBookmarkEdit, withDetached } from './document-changes';

describe('document changes', () => {
  it('keeps one decision per bookmark, the later parts added to the earlier', () => {
    let changes = withBookmarkEdit(NO_CHANGES, [0, 2], { title: 'New' });
    changes = withBookmarkEdit(changes, [1], { remove: true });
    changes = withBookmarkEdit(changes, [0, 2], { remove: true });
    expect(changes.bookmarks).toHaveLength(2);
    expect(bookmarkEdit(changes, [0, 2])).toEqual({ path: [0, 2], title: 'New', remove: true });
    expect(bookmarkEdit(changes, [0])).toBeUndefined();
  });

  it('forgets a decision', () => {
    const changes = withBookmarkEdit(withBookmarkEdit(NO_CHANGES, [3], { remove: true }), [3], null);
    expect(hasChanges(changes)).toBe(false);
  });

  it('takes an attached file out, once, or keeps it after all', () => {
    const out = withDetached(withDetached(NO_CHANGES, 'a.txt', true), 'a.txt', true);
    expect(out.detach).toEqual(['a.txt']);
    expect(hasChanges(withDetached(out, 'a.txt', false))).toBe(false);
  });
});
