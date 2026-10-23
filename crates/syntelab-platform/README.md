# syntelab-platform

Everything that differs between Windows, Linux and macOS: paths, Windows certificate store / PKCS#11 on Linux, file associations.

## What is here now

| Module | Role |
|---|---|
| `share` | Hands a file to the system's "Share" window (Windows 10 and later). On other systems it answers `Unsupported`, and the shell shows the file in its folder instead |

Each module has one interface and one file per system behind it
(`share/windows.rs`, `share/unsupported.rs`), so callers never write
`cfg(windows)` themselves.

## `certificates`

Certificates that can sign, and signatures made with them: the user's own
store on Windows (cards and tokens show there), or a `.pfx`/`.p12` file whose
key is used from memory and kept nowhere. `sign_detached` makes a detached CMS
signature (SHA-256, with `signing-certificate-v2`, as PAdES asks);
`verify_detached` says whether the bytes are unchanged and how far the
computer trusts the signer. Nothing goes online. Other systems: not yet.
The tests use `tests/fixtures/test-signer.pfx`, a certificate made for them only.
