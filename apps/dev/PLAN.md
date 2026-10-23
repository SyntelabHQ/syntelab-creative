# Dev: plan

Tools for developers, as an app of Syntelab Creative. The model is an
earlier web app of developer tools (not part of this repository).

## Decided by the owner (2026-10-11)

- The code of the model is a **specification only**. Nothing is copied from it; the tools are written anew for the program.
- **Only the tools.** No explanations, examples, common mistakes or FAQ under them: those belong to the website.
- **No links from Dev to the other apps** at this stage.
- Colour `#E91E63` and the icon of `apps/dev` stay.
- The program collects nothing and shares nothing. A tool that goes on the network does so because the user started it, to the address the user gave: that is allowed.
- What is typed or pasted into a tool is **never kept on disk**. Only settings and pins are.
- The work is done **in the order of the steps below**, one step at a time, each seen by the owner before the next. The interface comes first.

## Decided by the owner (2026-10-11, after seeing the interface)

- **Everything is offered without a limit of ours: the limit is the hardware.** No tool has a most for what it works on. A text is as long as memory holds it, a file as large as the disk does. What this asks of every tool:
  - what can be read as it comes is read so, a piece at a time, with memory that does not grow with the input;
  - a file too large to show stays on disk: the tool reads it from there and writes its result where the user says;
  - work that lasts runs on the Rust side, says how far it has got, and can be stopped;
  - memory is asked for in a way that can be refused, and a refusal is told, not crashed on.

## What the first version holds

The 22 tools of the model, less JS/CSS minify (put off), plus what the owner
added. In five menus:

| Menu | Tools |
|---|---|
| **Encode** | Base64 · URL encode/decode · HTML entities · JWT decoder · *Escape / unescape* · *Gzip* |
| **Data** | JSON formatter · JSONPath · JSON Schema validator · JSON Schema generator · JSON → TypeScript · YAML ↔ JSON · CSV ↔ JSON · XML / HTML formatter · SQL formatter · Diff |
| **Generate** | UUID · Hash (*with the check of a checksum*) · *Passwords and secrets* · *Keys and certificates* |
| **Inspect** | Regex tester · Cron explain · Unix timestamp · URL parser · Certificate decoder · *Hex viewer* |
| **Network** | *HTTP client* · *DNS lookup* · *Port check* · *Certificate of a site* |

In italics: not in the model. Gzip, escape/unescape, passwords and secrets,
and the check of a checksum were asked for by the owner. The hex viewer, keys
and certificates, the Network menu, "paste anything" on the first page and
files of any size with the Explorer menu were proposed, and are in the first
version as the coordinator of the project relayed it: **the owner confirms
them when their step comes**.

Second version: local servers (webhook receiver, static files, mock API),
chains of tools, JS/CSS minify.

## How it is built

- `frontend/tools/catalog.ts`: every tool once (id, menu, icon, whether it is built). Menus, the first page and the search are made from it.
- `frontend/start/`: the first page. The tools by menu, a search, the pinned ones first, and a box to paste anything into.
- `frontend/frame/`: the frame every tool is shown in, written once; a tool fills it. `tool-body` is a tool that takes a text and gives a text, fed in one of two ways: `text-tool` (a text or one file: what goes in, what comes out, the options over them, the line under them, Burn, the card of long work) and `batch-view` (many files or whole folders in one run, where their results go, how each came out). `split-panes` is the two panes with the line between them that is dragged; `layout` is what the View menu and the dragging decide; `empty-tool` stands for a tool that is not built. The frame has no head: the owner had the band with the name of the tool taken out (2026-10-11).
- `frontend/tools/<tool-id>/`: one folder for each tool, when its step comes; `frontend/tools/registry.ts` names the ones that are built. `frontend/tools/codec-tool.tsx` is what the tools that turn bytes into other bytes on the Rust side share (Base64, URL, HTML entities, escapes, gzip); on the Rust side they are stages of `backend/src/codec.rs`.
- `frontend/api/`: what every tool asks of the Rust side (files, progress, Stop). `frontend/frame/json-tree` shows a JSON document as a tree held by the Rust side; `frontend/frame/second-pane` is a second text under the input (a schema); `frontend/tools/derive-tool.tsx` is shared by the tools that write something from a sample.
- `frontend/settings/`: the settings of Dev, and its part of Settings.
- `backend/`: Rust, one module for each tool. Nearly everything is worked out there; the regex tester stays in the webview, its subject being the regular expressions of JavaScript.
- Reused: the editor (`packages/text-editor`, moved there from Scribe when Dev came to need it), the progress card with Stop (`ProgressCard` in `packages/ui-kit`, moved there from Units), the shell's commands, layouts, Help and Settings.

## Steps

Each step ends with: tests, a look with real clicks in the test copy, a report, and the owner's word before the next.

1. **The interface, without any logic.** The app is active. Menus: File, View, Encode, Data, Generate, Inspect, Network, Help; each tool with its icon and name. The first page (tools by menu, search, pins, the paste box drawn only). The frame of a tool, empty. Classic, ribbon and side-panel layouts; light and dark; English, Romanian, Arabic names. **Stop here for the owner to look.**
2. **The frame at work and the first tool.** The editors (Scribe's, shared), files in and out, copy, Burn, the line under the tool, the settings of Dev (a tool in the tab or in its own). JSON formatter in its simple form (format, minify, validate, the error and its place) as the first tool through the whole of it, Rust side included.
3. **Encode.** Base64; URL encode/decode; HTML entities; JWT decoder; escape / unescape; gzip.
4. **JSON in full.** The tree, counts, transforms, large files as a stream; JSONPath; JSON Schema validator and generator; JSON → TypeScript. The other ways of writing JSON the owner asked for (2026-10-11): keys sorted by their names (not as a stream: it takes memory as large as the file, and says so); short arrays and objects on one line; lines ended LF or CRLF, and a last line break or none; no space after the colon; letters that are not ASCII written as `\uXXXX`; lenient reading (comments, a comma after the last item) written again as strict JSON.
5. **Converters and formatters.** YAML ↔ JSON; CSV ↔ JSON (with the grid of Units for the preview); XML / HTML; SQL.
6. **Diff.** Text and JSON, side by side and unified.
7. **Generate.** UUID; Hash, with HMAC and the check of a checksum; passwords and secrets.
8. **Inspect.** Unix timestamp; cron; URL parser; certificate decoder; regex tester.
9. **"Paste anything"** on the first page: tells what was pasted and offers the tools that fit.
10. **Files and folders of any size.** Hashes of very large files; the Explorer menu for Dev's kinds of files. *(A folder in, a folder out, with progress and Stop, was brought forward by the owner and built with step 2: `backend/src/batch.rs`, `frontend/frame/batch-view.tsx`. Each tool only gives what it does to one file.)* The entries of the menu are declared in `app.json`; `frontend/start/launched.ts` decides the tool, `frontend/frame/launched-files.ts` carries the files to it.
11. **Hex viewer.** *(`backend/src/hex.rs`: bytes read where they are, sought a piece at a time; `frontend/tools/hex/`: `hex-view` draws the rows in sight, `hex-bytes` reads what is typed and what the bytes say.)*
12. **Keys and certificates.** RSA, EC and SSH keys, certificate requests, self-signed certificates, PEM ↔ DER ↔ PFX. *(`backend/src/keys.rs`; `frontend/tools/keys/`: `keys` asks, `keys-results` shows, `keys-told` lays out what can be copied and saved.)*
13. **Network.** HTTP client; DNS lookup; port check; the certificate of a site. *(The code that goes online is in `crates/syntelab-net/src/tools/`, under the rules of decision 0004; `frontend/frame/ask-tool` is the frame of the four tools, `frontend/tools/network/` what they share.)*
14. **The manual, About, the settings in full, Romanian and Arabic throughout**, and a last look at every tool with real clicks.

## Rules kept while working

- A difference from the model, or from this plan, is said in the report of the step it appears in.
- A new library is named with its licence in the report and goes in `THIRD-PARTY.md`.
- Nothing typed in a tool reaches the disk, a log or a list of recent things.
- Results must be those of the standard tools (the same SHA-256 as `sha256sum`, the same Base64 as everywhere): each tool has tests against known answers.
