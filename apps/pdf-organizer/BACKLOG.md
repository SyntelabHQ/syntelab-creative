# PDF Organizer: backlog

Open work for PDF Organizer. What is built is summed up in `PLAN.md`, section 7.

## Viewer and interface

- Fit visible content.
- A size limit for the thumbnail cache.
- Sub-menus in the classic menus (today the two Rotate groups are sections of the Organize menu).
- Proper icons for Attach a file, Bates numbering, Header and footer and Bookmarks, which use
  stand-ins (e.g. Font Awesome `paperclip`, `list-ul`).
- Pictures in the manual.

## Creating and exporting

- Create a PDF from a scanner (needs the system's scanning interface).
- Export to XLSX, PPTX, RTF, DOC, EPS and JPEG 2000; their place is Convert (`docs/decisions/0008`).
- PDF portfolios (several files of different kinds in one PDF package).

## Editing the document's own content

- Paragraphs that reflow when their text is changed.
- Picking up vector drawings (today only text lines and pictures).
- Pictures that cannot be picked up yet: CMYK pictures (refused), a picture overlapping another
  (both move), a picture clipped by the page (comes back whole).

## Bookmarks and attachments

- Moving a bookmark in the list and creating nested bookmarks.
- Undo for changes to bookmarks and attached files.

## Signatures

- Signing into an empty signature field the document already has (today a new field is always added).
- Certificate stores on Linux and macOS (only Windows and `.pfx`/`.p12` files today).
- Not yet tried: a real smart card or token (also for batch signing), and how other PDF readers
  (Adobe Reader) show the signature looks, the lock and time stamps from DigiCert.

## Batch processing

- A picture watermark; header and footer anywhere but the middle, with colours and sizes;
  Bates numbers across files; a password on the results.

## OCR

- An add-on that ships the Tesseract engine and its languages (today it must be installed separately).
- Straightening pages scanned askew.
- Reading a page again with other languages.
