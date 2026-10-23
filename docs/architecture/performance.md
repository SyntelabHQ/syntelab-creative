# Performance: no limits on pages, files, tabs

- **Lazy rendering**: only what is visible (+ a little around it).
- **Background thumbnails**, cached on disk, reused on reopen.
- **Streaming** for large operations: data written piece by piece, never all in memory.
- **Jobs** with progress and cancel for any long operation.
- **Memory watch**: warning before memory fills up; unused tabs release their images.
- Large-file tests: `tests/fixtures/generated/` (written by
  `node tools/generate-test-pdfs.mjs`) and each app's tests.
