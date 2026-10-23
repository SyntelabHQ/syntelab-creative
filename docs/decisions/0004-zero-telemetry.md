# 0004 — Zero telemetry

**Context:** We promise not to collect data. Documents (contracts, IDs) are private.

**Decision:** The app sends no data about the user. Connections only for: module catalog/downloads, update checks, news. All can be turned off. Updates install only with consent.

**Consequences:** All internet access goes through `crates/syntelab-net`. Problem reports are sent by the user, manually.

**Terminology (2026-10-09):** what this decision calls a "module" is now an **app** (see [0012](0012-apps-not-modules.md)); "module" now means a part of the code (see [0013](0013-modular-code.md)).

**Web pages (2026-10-10):** the owner asked for "Create a PDF from a web address", as other PDF programs have. This is one more connection, of another kind: it is made only when the user types an address and asks for that page, never by the program on its own. The page is fetched and laid out by the browser installed on the computer (run without a window, with a throw-away profile: no cookies, no history, nothing of the user's own browser), and the program itself sends nothing. The code is in `crates/syntelab-net` (`web_page.rs`) like everything else that goes online. The promise is unchanged: no data about the user leaves the computer.

**Text of a web page (2026-10-11):** the owner asked that Scribe's tool for the text of a web page take the address of the page, not only its source pasted by hand. It is the same kind of connection as the one above, under the same rules: only when the user types the address and asks, through the installed browser run without a window and with a throw-away profile, the program itself sending nothing (`web_page.rs`, `source`).

## Note of 2026-10-10: links in documents

A link in a document that the user clicks is handed to the system
(`AppHost.openLink`): a web page opens in the user's browser, `mailto:` in
their mail program. The program itself does not go online for it, and only
`http:`, `https:` and `mailto:` are handed over; where a link leads is shown
before the click.

## Note of 2026-10-10: signatures with a certificate

Signing and checking signatures stays on the computer: the chain of a
certificate is built from what Windows already has, and whether a certificate
was revoked is not asked (that would go online). A trusted timestamp and
long-term validation would need a server: not built until the owner decides.

## Note of 2026-10-22: whether a certificate is still good

Adobe Reader showed signatures made by the program with a warning: whether the
signer's certificate was revoked "could not be checked". The owner wants them
shown as valid. So when a signature gets a time stamp, the issuer of the
signing certificate is asked whether it is still good (OCSP, or its list of
revoked certificates), and the answer is kept inside the signature
(`adbe-revocationInfoArchival`), as Adobe Acrobat does.

- Only together with a time stamp: when the user signs with "Add a trusted
  time" ticked, or adds a time stamp to a document (then it is the
  authority's certificates that are asked about, and the answers are kept in
  the document's store for this, `/DSS`). Never in the background.
- Only to the addresses the certificate names. What is sent is the
  certificate's serial number and fingerprints of its issuer: nothing about
  the user beyond the certificate, which the signature carries anyway, and
  never the document.
- If no issuer answers, the signature is still made, without the answer.
- The code is in `crates/syntelab-net` (`revocation.rs`).

The same day the owner asked for a "Validate" button in Sign → Verify
signatures: it asks, for the signature it is under, whether its certificate
(or one that issued it) has been revoked. This is the one connection that does
not go through `syntelab-net`: Windows' own chain engine asks the issuers named
in the certificates (OCSP, lists of revoked certificates, and the certificate
of an issuer the signature does not carry), and checks their signed answers
itself, which is more than the program could do as well. It goes online only
when the user presses the button, to those addresses only, and what is sent
is the same as above. The code is in `crates/syntelab-platform`
(`certificates.rs`, `check_revocation`). Showing a certificate (Windows'
certificate window) stays offline.

## Note of 2026-10-21: time stamps

The owner decided that signatures need a trusted time ("digital signatures
are essential in the program"). A time stamp is asked of a time-stamping
authority (RFC 3161): DigiCert's (`http://timestamp.digicert.com`) unless the
user sets another in PDF Organizer's settings.

- Only when the user signs with "Add a trusted time" ticked (it starts ticked,
  as Settings say), or chooses Sign → "Add timestamp"; never in the background.
- What is sent is a SHA-256 fingerprint of the signature (or of the document,
  for a time stamp of the document) and a random number of the request.
  Never the document, never anything about the user; the same `User-Agent`
  for everyone. Plain HTTP is allowed, as authorities use it: the answer is
  signed, and is checked against what was asked before it is used.
- The code is in `crates/syntelab-net` (`time_stamp.rs`) like everything else
  that goes online. Whether a certificate was revoked was not asked then (see
the note of 2026-10-22).

## Note of 2026-10-11: rates of exchange

The currency converter of Units needs rates of exchange, and the owner chose
where they come from: ExchangeRate-API (`open.er-api.com`) for the currencies
of countries, CoinGecko (`api.coingecko.com`, without a key) for
cryptocurrencies. It is one more kind of connection, to two services that are
not ours, made only while the currency converter is used: when it is opened,
when the rates it has are old, and when the user presses "Refresh". Only the
rates are asked for, at two fixed addresses: nothing about the user is sent,
and never the amounts being converted. The last rates are kept on the
computer and used, marked as old, when there is no connection. The code is in
`crates/syntelab-net` (`rates.rs`) like everything else that goes online. The
promise is unchanged: no data about the user leaves the computer.

## Note of 2026-10-12: the network tools of Dev

Dev has four tools that go online, as the owner decided (step 13 of its
plan): an HTTP client, a DNS lookup, a port check, and the certificate of a
site. They are instruments the user points, and so another kind of
connection than the ones above: the address is not ours and not fixed, it
is whatever the user types.

- Only when the user types an address and presses the button; never on the
  program's own initiative, never in the background, never on a timer.
- Only to that address: the server of the request (and where it sends the
  request on, when the user leaves "Follow redirects" on), the host whose
  ports are tried, the site whose certificate is asked for. A DNS question
  goes to the name server the computer is already set to use, unless the
  user chooses another.
- What is sent is what the user wrote. The program adds only what the
  protocol needs, and, when the user names none, a `User-Agent` that is the
  same for everyone (`Syntelab Creative`). Nothing about the user, the
  computer or the installed version; no cookies are kept between requests.
- Nothing typed is kept: not the addresses, not the headers (where secrets
  are), not the answers. It is all in the tab until Burn.

The code is in `crates/syntelab-net` (`tools/`) like everything else that
goes online. The promise is unchanged: the program collects nothing and
sends nothing about the user.
