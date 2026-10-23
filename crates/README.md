# crates — shared Rust code

Used by the shell and every app. An app depends only on what is here,
never on another app.

| Crate | Role |
|---|---|
| `syntelab-app-api` | The contract (trait `SyntelabApp`) every app implements |
| `syntelab-apps-manager` | Catalog, download, verification, install, enable/disable of apps and add-ons |
| `syntelab-compare` | Compares two texts line by line, with the words that changed inside a line. Used by Scribe and Dev |
| `syntelab-encoding` | Tells how the bytes of a text are written (UTF-8, UTF-16, the old encodings) and reads them. Used by Scribe and Dev |
| `syntelab-platform` | Windows/Linux/macOS differences: paths, certificate store, file associations |
| `syntelab-net` | The only code that goes online (no telemetry) |
| `syntelab-office-bridge` | Finds installed Office/LibreOffice and converts documents through it. Used by PDF Organizer and Convert |
