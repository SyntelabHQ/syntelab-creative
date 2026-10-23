# Third-party software

What Syntelab Creative is built from, with the license of each part. Every
part must have a license compatible with AGPL-3.0 (see `docs/legal/README.md`).

This file lists the parts the project depends on **directly**. Each of them
brings others with it; the complete list, with the license texts, is to be
generated from `Cargo.lock` and `package-lock.json` for every release and
shipped with the program.

When a dependency is added, removed or changes its license, this file changes
in the same commit.

## In the program

### Rust

| Part | License | Used for | Where |
|---|---|---|---|
| [MuPDF](https://mupdf.com), through the [`mupdf`](https://github.com/messense/mupdf-rs) crate (with its picture, text layout and system font parts) | AGPL-3.0 | Reading, drawing and writing PDFs; reading pictures; laying out text files as pages | `apps/pdf-organizer/backend` (a patched copy of the crate is in `third-party/mupdf`, see `third-party/README.md`) |
| [Tauri](https://github.com/tauri-apps/tauri) (`tauri`, `tauri-build`) | Apache-2.0 OR MIT | The program window and the bridge between interface and Rust | `shell/src-tauri` |
| [`tauri-plugin-dialog`](https://github.com/tauri-apps/plugins-workspace) | Apache-2.0 OR MIT | The system's open, save and folder windows | `shell/src-tauri` |
| [`tauri-plugin-opener`](https://github.com/tauri-apps/plugins-workspace) | Apache-2.0 OR MIT | Opening syntelab.com pages in the browser; showing a file in its folder | `shell/src-tauri` |
| [`serde`](https://github.com/serde-rs/serde), [`serde_json`](https://github.com/serde-rs/json) | MIT OR Apache-2.0 | JSON between interface and Rust, and the manifests | every crate |
| [`ureq`](https://github.com/algesten/ureq) | MIT OR Apache-2.0 | The few requests to syntelab.com (update check, changelog), and the HTTP client of Dev | `crates/syntelab-net` |
| [`rustls`](https://github.com/rustls/rustls), with [`rustls-webpki`](https://github.com/rustls/webpki) (ISC), [`ring`](https://github.com/briansmith/ring) (Apache-2.0 AND ISC) and [`webpki-roots`](https://github.com/rustls/webpki-roots) (CDLA-Permissive-2.0) that it and `ureq` need | Apache-2.0 OR ISC OR MIT | TLS: the secure connections of `ureq`, and the handshake of "Certificate of a site" in Dev | `crates/syntelab-net` |
| [`rustls-platform-verifier`](https://github.com/rustls/rustls-platform-verifier) | MIT OR Apache-2.0 | Whether the computer trusts a certificate (the roots of the system), for the network tools of Dev | `crates/syntelab-net` |
| [`jpeg-encoder`](https://github.com/vstroebel/jpeg-encoder) | (MIT OR Apache-2.0) AND IJG | Writing the smaller pictures of "Compress" | `apps/pdf-organizer/backend` |
| [`windows`](https://github.com/microsoft/windows-rs), `windows-collections` | MIT OR Apache-2.0 | The Windows "Share" window | `crates/syntelab-platform` (Windows only) |
| [`num-bigint`](https://github.com/rust-num/num-bigint), [`num-rational`](https://github.com/rust-num/num-rational), [`num-traits`](https://github.com/rust-num/num-traits), [`num-integer`](https://github.com/rust-num/num-integer) | MIT OR Apache-2.0 | Exact numbers: conversions that are not rounded at every step | `apps/units/backend` |
| [`similar`](https://github.com/mitsuhiko/similar) | Apache-2.0 | Finding what differs between two texts: Scribe's compare and Dev's Diff | `crates/syntelab-compare` |
| [`flate2`](https://github.com/rust-lang/flate2-rs) | MIT OR Apache-2.0 | Gzip, both ways | `apps/dev/backend` |
| [`sha2`](https://github.com/RustCrypto/hashes), [`sha1`](https://github.com/RustCrypto/hashes), [`md-5`](https://github.com/RustCrypto/hashes) | MIT OR Apache-2.0 | The digests of the Hash tool, and those the signature of a JSON Web Token is checked with | `apps/dev/backend` |
| [`jiff`](https://github.com/BurntSushi/jiff), with the time zones of the IANA database it carries (`jiff-tzdb`) | Unlicense OR MIT | Dates, times and time zones: Unix timestamp and Cron explain | `apps/dev/backend` |
| [`url`](https://github.com/servo/rust-url), [`idna`](https://github.com/servo/rust-url) | MIT OR Apache-2.0 | Taking a URL apart as browsers read it | `apps/dev/backend` |
| [`x509-parser`](https://github.com/rusticata/x509-parser), with [`asn1-rs`](https://github.com/rusticata/asn1-rs), [`der-parser`](https://github.com/rusticata/der-parser), [`oid-registry`](https://github.com/rusticata/oid-registry), [`nom`](https://github.com/rust-bakery/nom) and [`time`](https://github.com/time-rs/time) that it needs | MIT OR Apache-2.0 | Reading X.509 certificates | `apps/dev/backend` |
| [`rsa`](https://github.com/RustCrypto/RSA), with [`num-bigint-dig`](https://github.com/dignifiedquire/num-bigint) that it needs | MIT OR Apache-2.0 | Making RSA keys and signing with them (Keys and certificates). Known advisory RUSTSEC-2023-0071 (timing of signatures seen over a network); keys are only made and written locally | `apps/dev/backend` |
| [`p256`, `p384`, `p521`](https://github.com/RustCrypto/elliptic-curves), with [`ecdsa`](https://github.com/RustCrypto/signatures), [`elliptic-curve`](https://github.com/RustCrypto/traits) and [`crypto-bigint`](https://github.com/RustCrypto/crypto-bigint) that they need | Apache-2.0 OR MIT | Keys and ECDSA signatures of the NIST curves | `apps/dev/backend` |
| [`ed25519-dalek`, `curve25519-dalek`](https://github.com/dalek-cryptography/curve25519-dalek) | BSD-3-Clause | Ed25519 keys and signatures | `apps/dev/backend` |
| [`pkcs8`, `pkcs5`, `pkcs1`, `sec1`, `spki`, `der`, `x509-cert`](https://github.com/RustCrypto/formats) | Apache-2.0 OR MIT | The forms keys, requests and certificates are written in (PKCS #8, PKCS #1, SEC 1, X.509, PKCS #10, DER, PEM) | `apps/dev/backend` |
| [`ssh-key`](https://github.com/RustCrypto/SSH), with the ciphers and hashes of [RustCrypto](https://github.com/RustCrypto) that locking a key needs (`bcrypt-pbkdf`, `aes`, `ctr`, `aes-gcm`, `chacha20`, `blowfish`) | Apache-2.0 OR MIT | OpenSSH key files, read and written | `apps/dev/backend` |
| [`p12-keystore`](https://github.com/ancwrd1/p12-keystore), with `pkcs12`, `cms`, `des`, `rc2`, `cbc`, `hmac`, `pbkdf2`, `scrypt` of [RustCrypto](https://github.com/RustCrypto) that it needs (and an older `x509-parser`) | MIT OR Apache-2.0 | PKCS #12 files (.pfx, .p12), read and written | `apps/dev/backend` |
| [`rand_core`](https://github.com/rust-random/rand) | MIT OR Apache-2.0 | The random numbers keys are made from, taken from the operating system | `apps/dev/backend` |
| [`aes`, `cbc`, `des`](https://github.com/RustCrypto) | MIT OR Apache-2.0 | Opening keys locked the old way of OpenSSL (Keys and certificates) | `apps/dev/backend` |
| [`encoding_rs`](https://github.com/hsivonen/encoding_rs) | (Apache-2.0 OR MIT) AND BSD-3-Clause | Reading and writing text in the encodings the web knows (Scribe; Dev when a file is not UTF-8) | `crates/syntelab-encoding`, `apps/scribe/backend` |
| [`chardetng`](https://github.com/hsivonen/chardetng) | Apache-2.0 OR MIT | Guessing the encoding of a text that carries no mark | `crates/syntelab-encoding` |
| [EFF Large Wordlist for Passphrases](https://www.eff.org/dice) (data, used as it is) | CC BY 3.0 US | The words passphrases are made of (Passwords and secrets) | `apps/dev/backend/data/eff_large_wordlist.txt` |
| [`crc32fast`](https://github.com/srijs/rust-crc32fast) | MIT OR Apache-2.0 | CRC-32 in the Hash tool | `apps/dev/backend` |
| [`uuid`](https://github.com/uuid-rs/uuid) | Apache-2.0 OR MIT | Making UUIDs (RFC 9562) and taking them apart | `apps/dev/backend` |
| [`getrandom`](https://github.com/rust-random/getrandom) | MIT OR Apache-2.0 | Random bytes from the operating system, for passwords, secrets and UUIDs (Scribe uses it too) | `apps/dev/backend` |
| [`jsonschema`](https://github.com/Stranger6667/jsonschema) (without its network and file parts) | MIT | Checking a document against a JSON Schema | `apps/dev/backend` |
| [`regex`](https://github.com/rust-lang/regex) | MIT OR Apache-2.0 | The patterns of JSONPath's `match` and `search` (Scribe uses it too) | `apps/dev/backend` |
| [`yaml-rust2`](https://github.com/Ethiraric/yaml-rust2) (without its part for other encodings), with [`hashlink`](https://github.com/djc/hashlink) and [`arraydeque`](https://github.com/andylokandy/arraydeque) that it needs | MIT OR Apache-2.0 | Reading YAML (YAML ↔ JSON) | `apps/dev/backend` |
| [`calamine`](https://github.com/tafia/calamine) | MIT | Reading Excel and OpenDocument workbooks that are imported into a table | `apps/units/backend` |
| [`rust_xlsxwriter`](https://github.com/jmcnamara/rust_xlsxwriter) | MIT OR Apache-2.0 | Writing a table as an Excel workbook | `apps/units/backend` |
| [`arboard`](https://github.com/1Password/arboard) | MIT OR Apache-2.0 | Reading and writing the clipboard when a table is copied and pasted | `apps/units/backend` |

### Interface

| Part | License | Used for |
|---|---|---|
| [React](https://react.dev) (`react`, `react-dom`) | MIT | The interface |
| [`intl-messageformat`](https://formatjs.github.io) | BSD-3-Clause | Translated texts with plurals (ICU MessageFormat) |
| `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-opener` | Apache-2.0 OR MIT | The interface's side of the Tauri parts above |
| [CodeMirror](https://codemirror.net) (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/search`) | MIT | The text editor of Scribe and Dev (`packages/text-editor`) |
| [`@codemirror/lang-json`](https://github.com/codemirror/lang-json), with [`@codemirror/language`](https://github.com/codemirror/language) and [`@lezer/highlight`](https://github.com/lezer-parser/highlight) | MIT | Reading JSON in the editor and colouring it (`packages/text-editor`, used by Dev) |
| [`@codemirror/lang-yaml`](https://github.com/codemirror/lang-yaml), [`@codemirror/lang-xml`](https://github.com/codemirror/lang-xml), [`@codemirror/lang-html`](https://github.com/codemirror/lang-html) (with [`@codemirror/lang-css`](https://github.com/codemirror/lang-css) and [`@codemirror/lang-javascript`](https://github.com/codemirror/lang-javascript) that it needs), [`@codemirror/lang-sql`](https://github.com/codemirror/lang-sql), and the `@lezer` parsers they bring | MIT | Reading YAML, XML, HTML and SQL in the editor and colouring them (`packages/text-editor`, used by Dev) |

### Fonts and icons

| Part | License | Used for |
|---|---|---|
| [IBM Plex Sans](https://github.com/IBM/plex) and IBM Plex Sans Arabic, from the `@fontsource` packages | SIL OFL 1.1 | The interface font |
| [Sansation](https://fonts.google.com/specimen/Sansation) by Bernd Montag | SIL OFL 1.1 | The brand font (`assets/brand/fonts/sansation/`, with its `OFL.txt`) |
| [Font Awesome Free](https://fontawesome.com) icons | CC BY 4.0 | Every icon (`assets/icons/`) and the program logo; the attribution comment stays inside each file (`docs/decisions/0014-font-awesome-free-icons.md`) |
| The base 14 PDF fonts that come with MuPDF (URW) | AGPL-3.0, with MuPDF | Page numbers and text added to a PDF |

## Only while building and testing

Not part of the program that is shipped.

| Part | License | Used for |
|---|---|---|
| [Vite](https://vite.dev), `@vitejs/plugin-react` | MIT | Building the interface |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 | Checking the interface's code |
| [Vitest](https://vitest.dev) | MIT | Interface tests |
| `@tauri-apps/cli` | Apache-2.0 OR MIT | Building and running the program |
| `@types/react`, `@types/react-dom` | MIT | Type descriptions |
| [`png`](https://github.com/image-rs/image-png) | MIT OR Apache-2.0 | Looking at drawn pages in the Rust tests |

## Programs used when they are installed

Not shipped with Syntelab Creative and not required by it.

| Program | Used for |
|---|---|
| LibreOffice, or Microsoft Office (Word, Excel, PowerPoint) | Turning office documents into PDF pages (`crates/syntelab-office-bridge`). Whichever is on the computer is asked to open the file and export a PDF; without either, office documents cannot be added |
