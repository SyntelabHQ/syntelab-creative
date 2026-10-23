# 0008 — Boundary between PDF Organizer and Convert

**Context:** Both modules touch conversions (e.g. Word → PDF when merging).

**Decision:** **PDF Organizer**: everything that produces or changes a PDF in the organizing flow, including merging from images/text/Word and "Combine to PDF". **Convert**: conversions between formats (PDF → Word/Excel, images, documents, "Convert to…" for anything). Code both need (Office/LibreOffice) lives in `crates/syntelab-office-bridge`.

**Consequences:** PDF → Word/Excel, previously listed as "later" for PDF, moves to Convert. Modules stay independent: each works without the other.

**Terminology (2026-10-09):** what this decision calls a "module" is now an **app** (see [0012](0012-apps-not-modules.md)); "module" now means a part of the code (see [0013](0013-modular-code.md)).

**Export (2026-10-10):** the owner asked that PDF Organizer can save a document in other formats, as other PDF programs do. "Export" in PDF Organizer writes what the PDF engine itself can produce: pictures of the pages (PNG, JPEG, TIFF, SVG), text (plain, HTML, XML), PostScript, and a rebuilt word processor document (DOCX, ODT). Convert stays the place for conversions that need more than the PDF engine (PDF → Excel or PowerPoint, conversions between other formats, batches). Both use the same engine; neither needs the other.
