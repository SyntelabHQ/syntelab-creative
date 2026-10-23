# PDF Organizer — Plan

## 1. First version

- **Fast viewer**: zoom, text search, thumbnails. Each document in its own tab.
- **Merge** from PDF, images, text. Word/Excel through Office or
  LibreOffice if installed (`crates/syntelab-office-bridge`).
- **Binder view**: each file is a card showing its page count. Open the
  card to pick exactly which pages go in.
- **Page organizing**: split, rotate, reorder (drag & drop), extract,
  delete, crop, resize (A4/Letter/Legal).
- **Add** text, images, shapes.
- **Forms**: fill in.
- **Watermark**, **page numbers**, **bookmarks**.
- **Windows Explorer right-click**: "Combine to PDF" and "Convert to PDF"
  (can be turned off in settings).

## 2. Signatures

### Visual
An image or a drawn signature placed on the page.

### Qualified (certificate-based)
- **PAdES** standard (legally accepted in the EU).
- **USB tokens** from: certSIGN, DigiSign, Trans Sped, AlfaTrust.
- Windows: the Windows certificate store. Linux: PKCS#11 (token driver).
- **Timestamp** and **LTV** (stays verifiable for years).
- **Multiple signatures** on the same document; **verification** of
  signatures in received documents.
- Visible appearance: on the **chosen page** (default), on **all pages**,
  or **invisible**.

## 3. Later

- OCR (add-on, downloaded on demand, per chosen language)
- Redaction (permanent removal)
- Compression
- Compare two PDFs
- Batch processing

PDF → Word/Excel is no longer here: it moved to **Convert**
(`docs/decisions/0008-pdf-organizer-convert-boundary.md`).

## 4. Order of work

1. Viewer: lazy rendering, cached thumbnails, search.
2. Page organizing + binder view + merge.
3. Editing (text, images, shapes), forms, watermark, page numbers, bookmarks.
4. Visual signature, then qualified PAdES.
5. Right-click entries (through `integrations/`).

## 5. Localization

All texts in `locales/en.json`, namespace `pdf-organizer.*`. Shared words
(Open, Save, Page...) come from `common.*`. OCR language data is separate
from UI languages: the user picks which OCR languages to download.

## 6. Open questions

- ~~Default timestamp authority (TSA).~~ Decided 2026-10-21: DigiCert (`http://timestamp.digicert.com`), changeable in Settings.

## 7. Where things stand

Kept short; what is still open is listed in `BACKLOG.md`.

Done:
- Viewer: zoom and fit modes, one or two pages, scrolling or page by page,
  read mode and full screen, thumbnails, bookmarks panel, find in document,
  document properties, print, share.
- Page organizing: select, move, turn, delete, insert, replace, extract,
  split, crop, resize; undo and redo; save and save as.
- Binder: PDFs, pictures, text files and office documents as cards, pages
  chosen per card, combined into one PDF.
- On the page: shapes, arrows, marks (tick, cross, dot), text in three fonts,
  highlight and redaction are drawn on the page itself and stay objects that
  can be moved, resized, turned and restyled until the file is saved
  (`frontend/marks/`); a watermark (text or a picture) is such an object on
  each page. Pictures, a handwritten signature or initials and page numbers
  are placed through a window.
- Documents not saved yet ("drafts"): what is extracted, combined or created
  opens in a tab and is saved where the user says. "Create a PDF": from a
  file, several files, a saved web page, the clipboard, or blank pages.
- The document's own text can be rewritten line by line (the old line is
  taken out of the file, the new one stands in its place); an object put on
  a page can be repeated on other pages and then moves as one.
- Text, watermarks and page numbers in the fonts installed on the computer
  (`crates/syntelab-platform`, `fonts`); pages copied and pasted in the grid.
- Export to other formats (pictures, text, word processor documents); rulers
  and a grid; printing on the paper and in the layout set in the settings.
- Settings of the app, apart from the suite's: how a document opens, what the
  quick toolbar shows, the names of new documents, its own layout.
- Forms: filling in.
- Compress; compare two documents by their text.
- Signatures with a certificate (PAdES), with a time stamp and long-term
  validation; verification of signatures.
- Batch processing; OCR with the Tesseract engine when it is installed.
- Windows Explorer right-click entries, first step
  (`integrations/windows-shell/README.md`).

How changes are kept until the user saves: the pages as arranged are a list
("page plan", `frontend/document/page-plan.ts`). Moving, turning and deleting
change the list only. What is drawn on a page ("marks") travels with the page
in the list and is written into it only when a file is made. A change of the
page itself (crop, another sheet size, numbers, a placed picture or signature)
is done on the Rust side at once, into a working file of the program's own,
and the changed page takes the place of the old one in the list. Saving writes a new file from the list. No open file is
ever changed before that.

Not done:
- Signing with a real token or card is not tried yet.
- Moving and nesting bookmarks (renaming and removing work); moving a placed picture or signature after it was put on
  the page (marks can be moved; these are written at once).
- A PDF from a scanner. Export to Excel, PowerPoint, RTF, EPS, JPEG 2000.
- The OCR add-on that brings the engine and its languages along.
- Fit visible content; a size limit for the thumbnail cache.
