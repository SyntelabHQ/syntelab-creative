//! Signing and verifying with a certificate from a file (Windows only: the other systems have no certificates yet).
#![cfg(windows)]

use syntelab_platform::certificates::{certificate_of, sign_detached, verify_detached, CertificateError, Source, Trust};

const FILE: &[u8] = include_bytes!("fixtures/test-signer.pfx");
const PASSWORD: &str = "test-only";

#[test]
fn opens_a_certificate_file_with_its_password_only() {
    let certificate = certificate_of(Source::File { data: FILE, password: PASSWORD }).expect("opens");
    assert_eq!(certificate.subject, "Syntelab Test Signer");
    assert_eq!(certificate.id.len(), 40);
    assert!(certificate.valid_until > certificate.valid_from);

    assert_eq!(certificate_of(Source::File { data: FILE, password: "wrong" }), Err(CertificateError::WrongPassword));
    assert!(certificate_of(Source::File { data: b"not a certificate file", password: PASSWORD }).is_err());
}

#[test]
fn signs_bytes_and_tells_when_they_were_changed() {
    let (before, after) = (b"what comes before the signature ".as_slice(), b"and what comes after it".as_slice());
    let signature = sign_detached(Source::File { data: FILE, password: PASSWORD }, &[before, after]).expect("signs");
    // A CMS message: a sequence, carrying the attribute that names the signing certificate.
    assert_eq!(signature[0], 0x30);
    let names_the_certificate = [0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x09, 0x10, 0x02, 0x2F];
    assert!(signature.windows(names_the_certificate.len()).any(|window| window == names_the_certificate));

    let verified = verify_detached(&signature, &[before, after]).expect("a signature");
    assert!(verified.intact);
    assert_eq!(verified.signer, "Syntelab Test Signer");
    // Made for the tests: no computer trusts it.
    assert_eq!(verified.trust, Trust::Untrusted);

    // The same bytes cut elsewhere are still the same bytes.
    let whole = [before, after].concat();
    assert!(verify_detached(&signature, &[&whole]).expect("a signature").intact);

    let changed = verify_detached(&signature, &[before, b"and what comes after IT"]).expect("a signature");
    assert!(!changed.intact);
    assert!(verify_detached(b"no signature at all", &[before]).is_err());
}
