# PDF Organizer — backend (Rust)

Crate `pdf-organizer-backend`. Implements `SyntelabApp` from
`crates/syntelab-app-api` (see `src/lib.rs` for the commands and resources).

| Module | Job |
|---|---|
| `src/lib.rs` | The app as the shell sees it: commands, resources, error codes |
| `src/engine/` | The PDF engine. **The only module that touches MuPDF.** `mupdf_file` reads and draws (a document belongs to the thread that opened it); `assemble` writes a new PDF from chosen pages of one or more files; the other files change pages, fill forms, sign, stamp, export and read text (OCR) |
| `src/render/` | Drawing off the interface thread: `pages` (on request, newest first, bounded queue), `thumbnails` (background pass + disk cache), built on `worker` and `queue` |
| `src/documents.rs` | The documents that are open; each holds a page thread and a thumbnail thread |
| `src/kept_files.rs` | Files of the program's own that outlive their document (drafts, working copies) |
| `src/batch_files.rs` | The folders and report of batch processing |
| `tests/` | Opens and draws real PDFs through the app, the way the shell does |

Rotating, deleting, reordering, extracting and inserting pages need no module
of their own here: the interface keeps a page plan and `save_pages` writes it
with `engine::assemble`.

Building needs LLVM/Clang (for the MuPDF bindings); see the root `README.md`.
Rust module files use underscores (`mupdf_file.rs`) because Rust module names
cannot contain hyphens.
