import { useTranslation } from '@syntelab/i18n';
import { Icon, tooltip } from '@syntelab/ui-kit';
import { useState } from 'react';
import { bookmarkEdit } from '../document/document-changes';
import type { DocumentChanges } from '../document/document-changes';
import type { Bookmark } from '../document/document-facts';
import styles from './bookmark-list.module.css';

export interface BookmarkListProps {
  readonly bookmarks: readonly Bookmark[];
  /** Where a page of the file is in the document now; undefined when it was removed. */
  readonly placeOf: (page: number) => number | undefined;
  readonly currentPage: number;
  readonly onGoToPage: (page: number) => void;
  /** New titles and removals that wait for the document to be saved. */
  readonly changes: DocumentChanges;
  /** Gives the bookmark at `path` (its place at every level, from 0) a new title, or takes it out. */
  readonly onEdit: (path: readonly number[], edit: { title?: string; remove?: boolean }) => void;
}

/** The document's table of contents, as a tree to move through the document with; its entries can be renamed and removed. */
export function BookmarkList({ bookmarks, placeOf, currentPage, onGoToPage, changes, onEdit }: BookmarkListProps) {
  const t = useTranslation();
  const shown = bookmarks.some((_, index) => !bookmarkEdit(changes, [index])?.remove);

  if (!shown) {
    return <p className={styles.none}>{t('pdf-organizer.bookmarks.none')}</p>;
  }
  return (
    <nav aria-label={t('pdf-organizer.command.bookmarks')} className={styles.list}>
      <Entries bookmarks={bookmarks} path={[]} placeOf={placeOf} currentPage={currentPage} onGoToPage={onGoToPage} changes={changes} onEdit={onEdit} />
    </nav>
  );
}

interface EntriesProps extends BookmarkListProps {
  /** Where these bookmarks are in the tree: the path of the one they are under. */
  readonly path: readonly number[];
}

function Entries({ bookmarks, path, ...rest }: EntriesProps) {
  return (
    <ul className={styles.entries}>
      {bookmarks.map((bookmark, index) =>
        // One that is taken out is gone from the list at once, with those under it.
        bookmarkEdit(rest.changes, [...path, index])?.remove ? null : <Entry key={index} bookmark={bookmark} path={[...path, index]} {...rest} />,
      )}
    </ul>
  );
}

interface EntryProps extends Omit<EntriesProps, 'bookmarks'> {
  readonly bookmark: Bookmark;
}

function Entry({ bookmark, path, placeOf, currentPage, onGoToPage, changes, onEdit }: EntryProps) {
  const t = useTranslation();
  const depth = path.length - 1;
  // The top level starts open, like the first glance at a table of contents.
  const [open, setOpen] = useState(depth === 0);
  /** The title being typed, while the bookmark is renamed. */
  const [typed, setTyped] = useState<string | null>(null);
  const place = bookmark.page === null ? undefined : placeOf(bookmark.page);
  const hasChildren = bookmark.children.length > 0;
  const title = bookmarkEdit(changes, path)?.title ?? bookmark.title;

  const rename = () => {
    if (typed !== null && typed.trim() !== '' && typed.trim() !== title) onEdit(path, { title: typed.trim() });
    setTyped(null);
  };

  return (
    <li>
      <div className={styles.row} style={{ paddingInlineStart: 6 + depth * 14 }}>
        {hasChildren ? (
          <button
            type="button"
            className={styles.fold}
            aria-expanded={open}
            aria-label={t(open ? 'pdf-organizer.bookmarks.fold' : 'pdf-organizer.bookmarks.unfold', { title })}
            onClick={() => setOpen(!open)}
          >
            <span className={styles.arrow} data-open={open}>
              <Icon name="chevron-down" size={10} />
            </span>
          </button>
        ) : (
          <span className={styles.fold} />
        )}
        {typed !== null ? (
          <input
            type="text"
            className={styles.rename}
            dir="auto"
            autoFocus
            maxLength={200}
            value={typed}
            aria-label={t('pdf-organizer.bookmarks.rename')}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={rename}
            onKeyDown={(event) => {
              // The keys of the page (arrows, Delete) are not meant here.
              event.stopPropagation();
              if (event.key === 'Enter') rename();
              else if (event.key === 'Escape') setTyped(null);
            }}
          />
        ) : (
          <>
            <button type="button" className={styles.title} aria-current={place === currentPage ? 'page' : undefined} disabled={place === undefined} onClick={() => place !== undefined && onGoToPage(place)}>
              <bdi className={styles.text}>{title}</bdi>
              {place !== undefined && <span className={styles.page}>{place + 1}</span>}
            </button>
            <span className={styles.tools}>
              <button type="button" className={styles.tool} aria-label={t('pdf-organizer.bookmarks.rename')} {...tooltip(t('pdf-organizer.bookmarks.rename'), 'bottom-end')} onClick={() => setTyped(title)}>
                <Icon name="pen" size={11} />
              </button>
              <button type="button" className={styles.tool} aria-label={t('pdf-organizer.bookmarks.remove')} {...tooltip(t('pdf-organizer.bookmarks.remove'), 'bottom-end')} onClick={() => onEdit(path, { remove: true })}>
                <Icon name="trash-can" size={11} />
              </button>
            </span>
          </>
        )}
      </div>
      {hasChildren && open && (
        <Entries bookmarks={bookmark.children} path={path} placeOf={placeOf} currentPage={currentPage} onGoToPage={onGoToPage} changes={changes} onEdit={onEdit} />
      )}
    </li>
  );
}
