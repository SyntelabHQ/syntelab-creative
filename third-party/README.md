# third-party — patched copies of dependencies

Normally dependencies come straight from crates.io or npm. A copy lives here
only when a fix we need is not in a published version yet. Each copy is used
through `[patch.crates-io]` in the root `Cargo.toml` and is deleted as soon as
a release contains the fix.

| Folder | What | Why | Remove when |
|---|---|---|---|
| `mupdf/` | `mupdf` 0.8.0 (Rust wrapper for MuPDF, AGPL-3.0), from crates.io, without its tests and examples | On Windows (MSVC) with a recent LLVM the crate does not compile: the type `max_align_t` is missing from the generated bindings ([mupdf-rs issue 258](https://github.com/messense/mupdf-rs/issues/258)). The fix from the project's main branch is applied in `src/device/native.rs` (marked "Syntelab Creative patch"). Nothing else is changed. | `mupdf` 0.9 (or any release with that fix) is published |

MuPDF itself (`mupdf-sys`) is not copied; it comes unchanged from crates.io.

Known bug in `mupdf-sys` 0.8.0, not patched: `Document::convert_to_pdf` (C wrapper
`mupdf_convert_to_pdf_internal` in `wrapper/document.c`) drops `resources` and
`contents` after each page but does not set them back to NULL, so from the second
page on `pdf_page_write` reuses freed objects (a use-after-free that crashes when the
PDF is dropped). Do not call it for more than one page; write the pages through
`DocumentWriter` with the `"pdf"` format instead, as PDF Organizer
(`engine/other_files.rs`) and Scribe (`export.rs`) do. One limit of `DocumentWriter`
in 0.8.0: its `Drop` closes the writer (which saves the PDF) without MuPDF's error
handling, so a write error at that moment (e.g. a full disk) ends the process. The
mupdf-rs main branch fixes both (`mupdf_convert_to_pdf_internal` resets the pointers,
and a new `mupdf_close_document_writer` catches close errors); when a release has
them, go back to `convert_to_pdf` + `save`, or use the fallible close.

## `pdfium/` (not in git)

`pdfium.dll` (PDFium 156.0.8076, from the `pypdfium2` 5.14.0 package on PyPI) and the licenses of what is
inside it. `tools/fetch-pdfium.mjs` puts them here before `npm run dev` and `npm run build`, checking the
package against its SHA-256; the installer takes them from here. To move to another PDFium, change the
version, the address and the SHA-256 at the top of that script.
