# syntelab-office-bridge

Detects Microsoft Office or LibreOffice and converts Word/Excel/PowerPoint through them. Central because two apps use it: PDF Organizer (merging) and Convert.

## How it works

Syntelab Creative has no code of its own that reads office formats. It asks an
office suite that is already on the computer to open the file and save it as
a PDF:

| Module | Role |
|---|---|
| `kind.rs` | Which files are office documents, and of which kind (text, sheet, slides) |
| `libre_office.rs` | LibreOffice, run without a window (`soffice --headless --convert-to pdf`); used first when it is installed, on every system |
| `ms_office.rs` | Microsoft Office on Windows: Word, Excel or PowerPoint opened in the background through their own automation and told to export a PDF |
| `run.rs` | Running the other program without a window, with a time limit |
| `error.rs` | What can go wrong; `NoOfficeSuite` when neither is installed |

Rules:
- The file is opened read-only and never changed; the PDF is written where the
  caller says.
- Nothing is sent anywhere: both suites work on this computer.
- The file names are handed over in a way the other program cannot mistake
  for commands (as arguments, or through environment variables).
- A conversion that takes longer than the time limit is stopped.
