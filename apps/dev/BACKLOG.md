# Dev: backlog

Open work for Dev. The tools of `PLAN.md` are built; the manual's topic "What Dev cannot do yet"
(`help/en.json`) lists the current limits for users.

## Tools not built yet

- JS / CSS minify: listed in the Data menu as put off (`later` in `frontend/tools/catalog.ts`).

## Encode and Data

- Base64: tell what the decoded bytes are, preview them, accept hexadecimal, write snippets (data URI, HTML, CSS).
- URL encode: a helper that takes a query string apart into its parameters.
- HTML entities: decode only entities that end in `;`; encode with HTML 4 names only.
- JWT: check signatures made with a private key (RS, PS, ES, EdDSA) and JWKS; today only HS256/384/512.
- JSON Schema validator: follow `$ref` to other files; messages are in English (from the library).
- JSONPath, the schema generator and JSON to TypeScript work on one document at a time (no Files mode).
- SQL formatter: a choice of dialect.
- CSV table view: copying from the table; a progress indicator while a very large file is read.

## Diff

- Show the JSON Pointer of each change beside the lines, not only in the JSON Patch.

## Inspect

- Regex tester: the `d` and `v` flags; running on a file kept on disk.
- The Inspect tools answer in JSON with English field names (only Cron explain has a laid-out view).
- Cron explain: systemd fractions of a second and day lists counted from the end of the month.

## Hex viewer

- Editing bytes; searching for patterns; other alphabets in the text column (today ASCII and Windows-1252).

## Keys and certificates

- Other key types (DSA, secp256k1, X25519); more than one key in a `.pfx`.
- Stopping the generation of a very large RSA key.
- `rsa` 0.9 has advisory RUSTSEC-2023-0071; move to a fixed release when one is out.

## Network

- HTTP client: HTTP/2 and 3; building multipart forms; keeping cookies on purpose.
- Port check: UDP. DNS lookup: verify DNSSEC. Certificate of a site: revocation check.

## Files and platform

- Files dropped on a tool are read only up to 16 MB (the webview does not give the path).
- Non-UTF-8 text is read only when small enough to show; files worked on from disk must be UTF-8.
- Passphrases use English words only.
- The right-click menu exists only for Windows Explorer.
