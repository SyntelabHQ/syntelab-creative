# Convert — Plan (draft)

Convert files between formats, locally, without sending anything online.

## Ideas for the first version (to be confirmed)

- **Documents**: Word/Excel/PowerPoint → PDF and back (PDF → Word/Excel, beta),
  through Office/LibreOffice where needed (`crates/syntelab-office-bridge`).
- **Images**: JPG, PNG, WebP, HEIC, TIFF, BMP between each other; images → PDF.
- **Batch**: many files at once, with progress and Cancel.
- **Windows Explorer right-click**: "Convert to…".

## Boundary with PDF Organizer

See `docs/decisions/0008-pdf-organizer-convert-boundary.md`.

## Open questions

- Exact list of formats for the first version.
- Whether audio/video belongs in Convert or in a separate app (it would
  bring heavy dependencies such as FFmpeg, so it would be an on-demand add-on).
