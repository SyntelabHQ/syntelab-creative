# syntelab-net

The only code that goes online: app catalog, updates, changelog, a web page the user asks to save as a PDF, time stamps for signatures, and the network tools of Dev, which go where the user points them. No identifiers, no telemetry. Can be turned off completely.

## What it does

It **reads** a fixed list of static files from syntelab.com (`remote-file.rs`)
and nothing else. A caller picks one of those files by name; it cannot pass a
URL.

| Module | Role |
|---|---|
| `remote_file.rs` | The files that may be read, and their addresses |
| `allow_list.rs` | Which addresses are acceptable at all: HTTPS, on syntelab.com |
| `client.rs` | The request itself: no cookies, no identifiers, size and time limits |
| `error.rs` | What can go wrong |
| `rates.rs` | Rates of exchange for the currency converter of Units, from two services at fixed addresses (see below) |
| `time_stamp.rs` | Asking a time-stamping authority for a time stamp, when the user signs a PDF (see below) |
| `revocation.rs` | Asking the issuer of the user's certificate whether it is still good, when the user signs a PDF with a time stamp (see below) |
| `web_page.rs` | Saving a web page as a PDF, or reading its source, when the user types its address and asks (see below) |
| `tools/` | The network tools of Dev: `http.rs` (one request, as the user wrote it), `dns.rs` (a question to a name server, written and read here), `port.rs` (whether ports take connections), `tls.rs` (the certificates a site shows) (see below) |

## Rules

- Requests are plain `GET`s of static files. Nothing about the user, the
  computer or the installed version is sent: no query string, no cookies, and
  the same short `User-Agent` for everyone.
- HTTPS only. A redirect is followed only to another allowed address.
- Answers are limited in size and time, so a broken server cannot hang or
  flood the program.
- Whether the program goes online at all is the user's setting; the shell
  asks this crate only when that setting allows it or the user presses
  "Check for updates".

## Rates of exchange

The currency converter of Units needs rates, and they are not on syntelab.com
(decision 0004, note of 2026-10-11). Two free services are asked, each at one
fixed address:

- `open.er-api.com` (ExchangeRate-API): the currencies of countries against
  the US dollar. It changes once a day, and is asked no more often than that.
- `api.coingecko.com` (CoinGecko): the prices of cryptocurrencies in US
  dollars. Asked when the currency converter is opened and when the user
  presses "Refresh", never on a timer.

Only while the currency converter is used. Only the rates are asked for:
nothing about the user, and never the amounts being converted. The coins
asked for are named by the data of the program.

## Time stamps

PDF Organizer asks a time-stamping authority (RFC 3161) for a time stamp when
the user signs with "Add a trusted time" ticked, or adds a time stamp to a
document (decision 0004, note of 2026-10-21):

- to the one address in PDF Organizer's settings (DigiCert's,
  `http://timestamp.digicert.com`, unless the user typed another);
  `http://` or `https://`, no name or password in it, no redirects;
- one `POST` of the request the caller made: a SHA-256 fingerprint and a
  random number, never the document and nothing about the user;
- the answer is limited to 256 KB and 30 seconds, and is checked by the
  caller (that it answers this request, with this fingerprint) before use.

## Whether a certificate is still good

When the user signs with "Add a trusted time" ticked, PDF Organizer also asks
the issuer of the signing certificate (and of the authorities above it, up to
the one at the top) whether the certificate is still good, so the answer can
be kept in the signature. When the user adds a time stamp to a document, the
same is asked about the time-stamping authority's certificates, and the
answers are kept in the document (`/DSS`). Either way the signature or stamp
can then be checked as good later without asking anyone (long-term
validation; decision 0004, note of 2026-10-22):

- only to the addresses the certificate itself names: its issuer's OCSP
  responder, its list of revoked certificates (CRL), and its issuer's own
  certificate when the computer does not have it; `http://` or `https://`,
  no name or password in them, at most 3 redirects;
- to an OCSP responder, one `POST` of the request the caller made: the
  certificate's serial number and SHA-1 fingerprints of its issuer's name and
  key. The rest is a plain download. Nothing of the document and nothing
  about the user beyond the certificate itself, which every signature carries;
- answers are limited to 256 KB (a list of revoked certificates to 8 MB) and
  20 seconds; they are signed by the issuer and checked by whoever reads the
  signature. If no issuer answers, the signature is made without its word.

## Web pages

"Create a PDF from a web address" (PDF Organizer) and "Text of a web page"
(Scribe) are the times the program goes to an address that is not
syntelab.com (decision 0004, notes of 2026-10-10 and 2026-10-11):

- only when the user types the address and asks for the page; never on the
  program's own initiative, never in the background;
- `http://` and `https://` addresses only (no files, no scripts);
- the page is fetched and laid out by the browser installed on the computer
  (Microsoft Edge or Google Chrome), run without a window and with a profile
  made for the occasion and deleted afterwards: the user's cookies, history
  and sign-ins are neither read nor changed;
- the program itself sends nothing; a time limit ends a page that hangs.

## The network tools of Dev

Dev's HTTP client, DNS lookup, port check and "Certificate of a site" are
instruments the user points at an address of their choosing (decision 0004,
note of 2026-10-12). The rules above about fixed addresses do not fit them;
these do:

- only when the user types the address and presses the button; never on the
  program's own initiative, never in the background;
- only to that address: a request to its server (and on to where the server
  points, when the user leaves that on), tries at the ports of its host, a
  handshake with its site; a DNS question to the name server the computer
  is set to use, or to one the user chooses;
- what is sent is what the user wrote, with what the protocol itself needs
  and, when the user names none, the same short `User-Agent` for everyone;
  no cookies are kept from one request to the next;
- `http://` and `https://` only for requests; a name of a host is checked
  to be one before it is handed to the system;
- a certificate is trusted when the computer trusts it (the roots of the
  system); the user may turn the check off for a server of their own, and
  is told so while it is off;
- every wait has an end the user sets, and long work (many ports, a large
  answer) shows how far it has got and can be stopped;
- nothing is logged and nothing is kept.

The port check opens one connection to each port and closes it at once: it
sends nothing. "Certificate of a site" does the handshake of TLS and no
more: no request is sent.

A DNS question may also go to a resolver asked over HTTPS (Cloudflare,
Google, or an `https://` address the user types): it is the same question,
sent as the body of one request to that address. A mail or FTP server,
which begins in the clear, is asked to go over to TLS in the few words its
protocol has for it (`EHLO localhost`, `STARTTLS`; `a1 STARTTLS`; `STLS`;
`AUTH TLS`), and nothing else is said to it. A file the user names can be
sent as the body of a request, read from where it is.
