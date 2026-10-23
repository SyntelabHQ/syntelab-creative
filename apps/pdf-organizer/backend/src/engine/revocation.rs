//! Whether a certificate was revoked, said by its issuer and kept inside the
//! signature, so a reader such as Adobe Reader can tell the signature is good
//! without asking anyone, now or years later (long-term validation, "LTV").
//!
//! The issuer says it in an OCSP answer (RFC 6960), or in its list of revoked
//! certificates (a CRL, RFC 5280). Both are signed by the issuer, so they are
//! kept as they came. They go into the signature as the attribute Adobe defined
//! for them (`adbe-revocationInfoArchival`), among those that are signed.
//!
//! What is asked is the certificate's serial number and fingerprints of its
//! issuer's name and key: nothing of the document or of the user beyond the
//! certificate itself, which every signature carries anyway. Asking is
//! `syntelab-net`'s; what is asked and what comes back is read and written here.

use sha1::{Digest, Sha1};

use super::time_stamp::{children, element, encoded, whole, Element};
use super::EngineError;

/// `adbe-revocationInfoArchival`: the attribute, as Windows names object identifiers.
pub const ARCHIVAL_ATTRIBUTE: &str = "1.2.840.113583.1.1.8";

/// `id-sha1`.
const SHA1: &[u8] = &[0x2B, 0x0E, 0x03, 0x02, 0x1A];
/// `id-pe-authorityInfoAccess`, and in it `id-ad-ocsp` and `id-ad-caIssuers`.
const AUTHORITY_INFO: &[u8] = &[0x2B, 0x06, 0x01, 0x05, 0x05, 0x07, 0x01, 0x01];
const OCSP: &[u8] = &[0x2B, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x01];
const CA_ISSUERS: &[u8] = &[0x2B, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x02];
/// `id-ce-cRLDistributionPoints`.
const CRL_POINTS: &[u8] = &[0x55, 0x1D, 0x1F];
/// `id-pkix-ocsp-basic`.
const OCSP_BASIC: &[u8] = &[0x2B, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x01, 0x01];

const SEQUENCE: u8 = 0x30;
const INTEGER: u8 = 0x02;
const BIT_STRING: u8 = 0x03;
const OCTET_STRING: u8 = 0x04;
const NULL: u8 = 0x05;
const OBJECT: u8 = 0x06;
const ENUMERATED: u8 = 0x0A;
/// `[0]`, `[1]` and `[3]` holding something whole; `[6]` an address (`uniformResourceIdentifier`).
const FIRST: u8 = 0xA0;
const SECOND: u8 = 0xA1;
const FOURTH: u8 = 0xA3;
const ADDRESS: u8 = 0x86;
/// The status of one certificate in an OCSP answer: `good` is `[0] IMPLICIT NULL`.
const GOOD: u8 = 0x80;

fn wrong(what: &str) -> EngineError {
    EngineError::Failed(format!("the certificate could not be read: {what}"))
}

/// What a certificate says that matters here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Facts<'a> {
    /// Its serial number, as DER writes the INTEGER (content only).
    pub serial: &'a [u8],
    /// Who issued it and whom it is of, as they are written (whole `Name`s).
    pub issuer: &'a [u8],
    pub subject: &'a [u8],
    /// The key it holds: the bits of `subjectPublicKey`, without the count of unused bits.
    pub public_key: &'a [u8],
    /// Where its issuer answers questions about it (OCSP), keeps its list of revoked ones (CRL), and keeps its own
    /// certificate: only `http://` and `https://` addresses.
    pub ocsp: Vec<String>,
    pub crls: Vec<String>,
    pub issuer_certificates: Vec<String>,
}

impl Facts<'_> {
    /// It is its own issuer: an authority at the top of a chain, of which no one is asked.
    pub fn self_issued(&self) -> bool {
        self.issuer == self.subject
    }
}

/// Reads a certificate (DER).
pub fn facts(certificate: &[u8]) -> Result<Facts<'_>, EngineError> {
    let fields = children(whole(certificate, SEQUENCE)?.content)?;
    let signed = fields.first().filter(|signed| signed.tag == SEQUENCE).ok_or_else(|| wrong("no content"))?;
    let mut parts = children(signed.content)?;
    // The version is there only when it is not the first.
    if parts.first().is_some_and(|version| version.tag == FIRST) {
        parts.remove(0);
    }
    // serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo, then what may be there.
    let [serial, _, issuer, _, subject, key, ..] = parts.as_slice() else {
        return Err(wrong("fields are missing"));
    };
    if serial.tag != INTEGER || issuer.tag != SEQUENCE || subject.tag != SEQUENCE || key.tag != SEQUENCE {
        return Err(wrong("a field is not what it should be"));
    }
    let key_parts = children(key.content)?;
    let bits = key_parts.get(1).filter(|bits| bits.tag == BIT_STRING && !bits.content.is_empty()).ok_or_else(|| wrong("no key"))?;

    let mut facts = Facts { serial: serial.content, issuer: issuer.whole, subject: subject.whole, public_key: &bits.content[1..], ocsp: Vec::new(), crls: Vec::new(), issuer_certificates: Vec::new() };
    let Some(extensions) = parts.iter().find(|part| part.tag == FOURTH) else {
        return Ok(facts);
    };
    for extension in children(whole(extensions.content, SEQUENCE)?.content)? {
        let inside = children(extension.content)?;
        let (Some(name), Some(value)) = (inside.first(), inside.last()) else {
            continue;
        };
        if name.tag != OBJECT || value.tag != OCTET_STRING {
            continue;
        }
        if name.content == AUTHORITY_INFO {
            for access in children(whole(value.content, SEQUENCE)?.content)? {
                let said = children(access.content)?;
                if let [method, place] = said.as_slice() {
                    let list = match method.content {
                        OCSP => &mut facts.ocsp,
                        CA_ISSUERS => &mut facts.issuer_certificates,
                        _ => continue,
                    };
                    if method.tag == OBJECT && place.tag == ADDRESS {
                        push_address(list, place.content);
                    }
                }
            }
        } else if name.content == CRL_POINTS {
            let mut found = Vec::new();
            addresses_in(value.content, 0, &mut found)?;
            for address in found {
                push_address(&mut facts.crls, address);
            }
        }
    }
    Ok(facts)
}

/// Every address (`[6]`) anywhere inside `bytes`.
fn addresses_in<'a>(bytes: &'a [u8], depth: usize, found: &mut Vec<&'a [u8]>) -> Result<(), EngineError> {
    if depth > 8 {
        return Ok(());
    }
    for item in children(bytes)? {
        if item.tag == ADDRESS {
            found.push(item.content);
        } else if item.tag & 0x20 != 0 {
            addresses_in(item.content, depth + 1, found)?;
        }
    }
    Ok(())
}

fn push_address(list: &mut Vec<String>, address: &[u8]) {
    let Ok(address) = std::str::from_utf8(address) else {
        return;
    };
    let lower = address.to_ascii_lowercase();
    if (lower.starts_with("http://") || lower.starts_with("https://")) && !list.iter().any(|known| known == address) {
        list.push(address.to_owned());
    }
}

/// What is asked of the issuer about `certificate`, which `issuer` issued: an `OCSPRequest` naming it by the
/// fingerprints (SHA-1, as every responder knows) of its issuer's name and key, and its serial number.
pub fn ocsp_request(certificate: &[u8], issuer: &[u8]) -> Result<Vec<u8>, EngineError> {
    let id = certificate_id(&facts(certificate)?, &facts(issuer)?);
    let one = encoded(SEQUENCE, &id);
    let list = encoded(SEQUENCE, &one);
    let asked = encoded(SEQUENCE, &list);
    Ok(encoded(SEQUENCE, &asked))
}

fn certificate_id(certificate: &Facts<'_>, issuer: &Facts<'_>) -> Vec<u8> {
    let algorithm = encoded(SEQUENCE, &[encoded(OBJECT, SHA1), vec![NULL, 0]].concat());
    let name = Sha1::digest(certificate.issuer);
    let key = Sha1::digest(issuer.public_key);
    encoded(SEQUENCE, &[algorithm, encoded(OCTET_STRING, &name), encoded(OCTET_STRING, &key), encoded(INTEGER, certificate.serial)].concat())
}

/// What an OCSP answer says of the certificate with this serial number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Good,
    /// Revoked, or not known to the issuer.
    NotGood,
}

/// Reads the issuer's answer (an `OCSPResponse`): what it says of the certificate with `serial`. `Err` when it is no
/// answer, or the issuer did not answer the question (it was busy, or refused).
pub fn ocsp_status(response: &[u8], serial: &[u8]) -> Result<Status, EngineError> {
    let parts = children(whole(response, SEQUENCE)?.content)?;
    let answered = parts.first().is_some_and(|status| status.tag == ENUMERATED && status.content == [0]);
    if !answered {
        return Err(wrong("the issuer did not answer"));
    }
    let bytes = parts.get(1).filter(|bytes| bytes.tag == FIRST).ok_or_else(|| wrong("the answer is empty"))?;
    let bytes = children(whole(bytes.content, SEQUENCE)?.content)?;
    match bytes.as_slice() {
        [kind, basic] if kind.tag == OBJECT && kind.content == OCSP_BASIC && basic.tag == OCTET_STRING => {
            let basic = children(whole(basic.content, SEQUENCE)?.content)?;
            let data = basic.first().filter(|data| data.tag == SEQUENCE).ok_or_else(|| wrong("the answer says nothing"))?;
            let mut data = children(data.content)?;
            if data.first().is_some_and(|version| version.tag == FIRST) {
                data.remove(0);
            }
            // responderID, producedAt, responses, then what may be there.
            let responses = data.get(2).filter(|responses| responses.tag == SEQUENCE).ok_or_else(|| wrong("the answer holds no status"))?;
            for single in children(responses.content)? {
                let said = children(single.content)?;
                let (Some(id), Some(status)) = (said.first(), said.get(1)) else {
                    continue;
                };
                let id = children(id.content)?;
                if id.get(3).is_some_and(|number| number.tag == INTEGER && number.content == serial) {
                    return Ok(if status.tag == GOOD { Status::Good } else { Status::NotGood });
                }
            }
            Err(wrong("the answer is about another certificate"))
        }
        _ => Err(wrong("the answer is of a kind not known")),
    }
}

/// True when `bytes` is one DER element that looks like a certificate or a list of revoked ones: a SEQUENCE, whole.
pub fn is_der_sequence(bytes: &[u8]) -> bool {
    matches!(element(bytes), Ok((Element { tag: SEQUENCE, .. }, rest)) if rest.is_empty())
}

/// The value of the attribute that keeps the issuers' word in a signature (`RevocationInfoArchival`):
/// `SEQUENCE { crl [0] EXPLICIT SEQUENCE OF CRL OPTIONAL, ocsp [1] EXPLICIT SEQUENCE OF OCSPResponse OPTIONAL }`.
pub fn archival(crls: &[Vec<u8>], ocsp: &[Vec<u8>]) -> Vec<u8> {
    let mut content = Vec::new();
    if !crls.is_empty() {
        content.extend(encoded(FIRST, &encoded(SEQUENCE, &crls.concat())));
    }
    if !ocsp.is_empty() {
        content.extend(encoded(SECOND, &encoded(SEQUENCE, &ocsp.concat())));
    }
    encoded(SEQUENCE, &content)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(content: &[u8]) -> Vec<u8> {
        encoded(OBJECT, content)
    }

    /// A certificate with what matters here, in the shape X.509 gives it (unsigned; nothing here checks signatures).
    fn certificate(serial: &[u8], issuer: &str, subject: &str, key: &[u8], extensions: &[Vec<u8>]) -> Vec<u8> {
        let name = |who: &str| encoded(SEQUENCE, &encoded(0x31, &encoded(SEQUENCE, &[object(&[0x55, 4, 3]), encoded(0x0C, who.as_bytes())].concat())));
        let algorithm = encoded(SEQUENCE, &[object(&[0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 1, 1, 11]), vec![NULL, 0]].concat());
        let validity = encoded(SEQUENCE, &[encoded(0x17, b"260101000000Z"), encoded(0x17, b"280101000000Z")].concat());
        let key_info = encoded(SEQUENCE, &[algorithm.clone(), encoded(BIT_STRING, &[&[0][..], key].concat())].concat());
        let mut fields = vec![encoded(FIRST, &encoded(INTEGER, &[2])), encoded(INTEGER, serial), algorithm.clone(), name(issuer), validity, name(subject), key_info];
        if !extensions.is_empty() {
            fields.push(encoded(FOURTH, &encoded(SEQUENCE, &extensions.concat())));
        }
        encoded(SEQUENCE, &[encoded(SEQUENCE, &fields.concat()), algorithm, encoded(BIT_STRING, &[0, 1, 2])].concat())
    }

    fn extension(name: &[u8], value: Vec<u8>) -> Vec<u8> {
        encoded(SEQUENCE, &[object(name), encoded(OCTET_STRING, &value)].concat())
    }

    fn signer_with_addresses() -> Vec<u8> {
        let access = |method: &[u8], address: &str| encoded(SEQUENCE, &[object(method), encoded(ADDRESS, address.as_bytes())].concat());
        let info = encoded(SEQUENCE, &[access(OCSP, "http://ocsp.example.com"), access(CA_ISSUERS, "http://ca.example.com/ca.crt"), access(OCSP, "ldap://ignored")].concat());
        // DistributionPoint { distributionPoint [0] { fullName [0] { uniformResourceIdentifier } } }
        let point = encoded(SEQUENCE, &encoded(FIRST, &encoded(FIRST, &[encoded(ADDRESS, b"http://crl.example.com/ca.crl"), encoded(ADDRESS, b"ldap://x")].concat())));
        let points = encoded(SEQUENCE, &point);
        certificate(&[0x01, 0x23], "Issuing CA", "Ionut", &[9, 9, 9], &[extension(AUTHORITY_INFO, info), extension(CRL_POINTS, points)])
    }

    #[test]
    fn reads_where_the_issuer_answers() {
        let bytes = signer_with_addresses();
        let read = facts(&bytes).expect("reads");
        assert_eq!(read.serial, [0x01, 0x23]);
        assert_eq!(read.public_key, [9, 9, 9]);
        assert_eq!(read.ocsp, ["http://ocsp.example.com"]);
        assert_eq!(read.issuer_certificates, ["http://ca.example.com/ca.crt"]);
        assert_eq!(read.crls, ["http://crl.example.com/ca.crl"]);
        assert!(!read.self_issued());
        let root = certificate(&[1], "Root", "Root", &[1], &[]);
        assert!(facts(&root).expect("reads").self_issued());
        assert!(facts(&[0x30, 0]).is_err());
    }

    #[test]
    fn asks_about_the_certificate_by_its_issuer_and_number() {
        let signer = signer_with_addresses();
        let issuer = certificate(&[5], "Root", "Issuing CA", &[4, 4], &[]);
        let asked = ocsp_request(&signer, &issuer).expect("asks");
        // OCSPRequest { tbsRequest { requestList { Request { reqCert } } } }
        let mut level = whole(&asked, SEQUENCE).expect("request").content;
        for _ in 0..3 {
            level = whole(level, SEQUENCE).expect("nested").content;
        }
        let id = children(whole(level, SEQUENCE).expect("id").content).expect("fields");
        assert_eq!(id.len(), 4);
        assert_eq!(id[1].content, Sha1::digest(facts(&signer).expect("reads").issuer).as_slice());
        assert_eq!(id[2].content, Sha1::digest([4, 4]).as_slice());
        assert_eq!(id[3].content, [0x01, 0x23]);
    }

    fn answer(serial: &[u8], status: Vec<u8>) -> Vec<u8> {
        let id = encoded(SEQUENCE, &[encoded(SEQUENCE, &[object(SHA1), vec![NULL, 0]].concat()), encoded(OCTET_STRING, &[1; 20]), encoded(OCTET_STRING, &[2; 20]), encoded(INTEGER, serial)].concat());
        let single = encoded(SEQUENCE, &[id, status, encoded(0x18, b"20261022120000Z")].concat());
        let data = encoded(SEQUENCE, &[encoded(SECOND, &encoded(SEQUENCE, &[])), encoded(0x18, b"20261022120000Z"), encoded(SEQUENCE, &single)].concat());
        let basic = encoded(SEQUENCE, &[data, encoded(SEQUENCE, &[]), encoded(BIT_STRING, &[0])].concat());
        let bytes = encoded(SEQUENCE, &[object(OCSP_BASIC), encoded(OCTET_STRING, &basic)].concat());
        encoded(SEQUENCE, &[encoded(ENUMERATED, &[0]), encoded(FIRST, &bytes)].concat())
    }

    #[test]
    fn reads_what_the_issuer_answers() {
        assert_eq!(ocsp_status(&answer(&[0x01, 0x23], vec![GOOD, 0]), &[0x01, 0x23]).expect("reads"), Status::Good);
        assert_eq!(ocsp_status(&answer(&[0x01, 0x23], encoded(SECOND, &encoded(0x18, b"20260101000000Z"))), &[0x01, 0x23]).expect("reads"), Status::NotGood);
        assert!(ocsp_status(&answer(&[7], vec![GOOD, 0]), &[0x01, 0x23]).is_err(), "about another certificate");
        // tryLater (3): no answer to keep.
        assert!(ocsp_status(&encoded(SEQUENCE, &encoded(ENUMERATED, &[3])), &[1]).is_err());
        assert!(ocsp_status(b"<html>", &[1]).is_err());
    }

    #[test]
    fn keeps_the_answers_as_adobe_reads_them() {
        let ocsp = answer(&[1], vec![GOOD, 0]);
        let crl = encoded(SEQUENCE, &[1, 2, 3]);
        let kept = archival(std::slice::from_ref(&crl), std::slice::from_ref(&ocsp));
        let parts = children(whole(&kept, SEQUENCE).expect("one sequence").content).expect("parts");
        assert_eq!((parts[0].tag, parts[1].tag), (FIRST, SECOND));
        assert_eq!(whole(parts[0].content, SEQUENCE).expect("crls").content, crl);
        assert_eq!(whole(parts[1].content, SEQUENCE).expect("answers").content, ocsp);
        let only_ocsp = archival(&[], &[ocsp]);
        assert_eq!(children(whole(&only_ocsp, SEQUENCE).expect("one").content).expect("parts")[0].tag, SECOND);
        assert!(is_der_sequence(&crl) && !is_der_sequence(b"-----BEGIN X509 CRL-----"));
    }
}
