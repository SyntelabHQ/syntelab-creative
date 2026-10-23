//! Time stamps (RFC 3161): a time-stamping authority (TSA) confirms, with a
//! signature of its own, that a fingerprint (SHA-256) existed at a moment.
//!
//! Two uses. A signature made with a certificate gets one over the signature
//! itself, kept inside it (`signature-time-stamp`, PAdES B-T): the signature
//! then stays good after its certificate ends, since it was clearly made
//! before. And a document can get one of its own (`/DocTimeStamp`), which
//! covers the file as a signature does.
//!
//! Only the fingerprint goes to the authority: never the document. Asking it is
//! `syntelab-net`'s; what is asked and what comes back is read and written here.

use super::EngineError;

/// `id-sha256`.
const SHA256: &[u8] = &[0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01];
/// `id-signedData`.
const SIGNED_DATA: &[u8] = &[0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x07, 0x02];
/// `id-ct-TSTInfo`: what a time stamp says.
const TST_INFO: &[u8] = &[0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x09, 0x10, 0x01, 0x04];
/// `id-aa-signatureTimeStampToken`: the attribute a signature keeps its time stamp in.
const SIGNATURE_TIME_STAMP: &[u8] = &[0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x09, 0x10, 0x02, 0x0E];

const SEQUENCE: u8 = 0x30;
const SET: u8 = 0x31;
const INTEGER: u8 = 0x02;
const OCTET_STRING: u8 = 0x04;
const OBJECT: u8 = 0x06;
const GENERALIZED_TIME: u8 = 0x18;
/// `[0]` and `[1]`, holding something whole (`EXPLICIT`, or a constructed `IMPLICIT`).
const FIRST: u8 = 0xA0;
const SECOND: u8 = 0xA1;

fn wrong(what: &str) -> EngineError {
    EngineError::Failed(format!("the time stamp could not be read: {what}"))
}

/// One element of DER: its tag, and where its content and the whole of it are in the bytes read.
#[derive(Clone, Copy)]
pub(super) struct Element<'a> {
    pub(super) tag: u8,
    pub(super) content: &'a [u8],
    pub(super) whole: &'a [u8],
}

/// The element at the start of `bytes`, and what follows it. Lengths must be written out (DER): no open-ended ones.
pub(super) fn element(bytes: &[u8]) -> Result<(Element<'_>, &[u8]), EngineError> {
    let short = || wrong("it ends too early");
    let (&tag, rest) = bytes.split_first().ok_or_else(short)?;
    if tag & 0x1F == 0x1F {
        return Err(wrong("a tag of more than one byte"));
    }
    let (&first, rest) = rest.split_first().ok_or_else(short)?;
    let (length, rest) = match first {
        0..=0x7F => (usize::from(first), rest),
        0x81..=0x84 => {
            let count = usize::from(first & 0x7F);
            let digits = rest.get(..count).ok_or_else(short)?;
            (digits.iter().fold(0_usize, |length, digit| (length << 8) | usize::from(*digit)), &rest[count..])
        }
        _ => return Err(wrong("a length that is not written out")),
    };
    let content = rest.get(..length).ok_or_else(short)?;
    let header = bytes.len() - rest.len();
    Ok((Element { tag, content, whole: &bytes[..header + length] }, &rest[length..]))
}

/// The elements inside a constructed one, in order.
pub(super) fn children(content: &[u8]) -> Result<Vec<Element<'_>>, EngineError> {
    let mut found = Vec::new();
    let mut rest = content;
    while !rest.is_empty() {
        let (child, after) = element(rest)?;
        found.push(child);
        rest = after;
    }
    Ok(found)
}

/// The only element of `bytes`, which must have this tag.
pub(super) fn whole(bytes: &[u8], tag: u8) -> Result<Element<'_>, EngineError> {
    let (found, rest) = element(bytes)?;
    if found.tag != tag || !rest.is_empty() {
        return Err(wrong("it is not what was expected"));
    }
    Ok(found)
}

pub(super) fn encoded(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut bytes = vec![tag];
    let length = content.len();
    if length < 0x80 {
        bytes.push(length as u8);
    } else {
        let digits: Vec<u8> = length.to_be_bytes().into_iter().skip_while(|digit| *digit == 0).collect();
        bytes.push(0x80 | digits.len() as u8);
        bytes.extend(digits);
    }
    bytes.extend_from_slice(content);
    bytes
}

fn joined(parts: &[&[u8]]) -> Vec<u8> {
    parts.concat()
}

/// A number for one request, which the answer must repeat: an old answer cannot be passed off as new.
/// Positive and without a leading zero, as DER wants an INTEGER.
pub fn nonce(seed: u128) -> [u8; 16] {
    let mut bytes = seed.to_be_bytes();
    bytes[0] = (bytes[0] & 0x7F).max(1);
    bytes
}

/// What is sent to the authority: the fingerprint, the number of this request, and a request for its certificate
/// (kept in the stamp, so the stamp can be checked without asking anything more).
pub fn query(digest: &[u8; 32], nonce: &[u8; 16]) -> Vec<u8> {
    let algorithm = encoded(SEQUENCE, &joined(&[&encoded(OBJECT, SHA256), &[0x05, 0x00]]));
    let imprint = encoded(SEQUENCE, &joined(&[&algorithm, &encoded(OCTET_STRING, digest)]));
    encoded(SEQUENCE, &joined(&[&encoded(INTEGER, &[1]), &imprint, &encoded(INTEGER, nonce), &[0x01, 0x01, 0xFF]]))
}

/// The time stamp out of the authority's answer, once it is seen to be over `digest` and to repeat `nonce`.
pub fn token_of(reply: &[u8], digest: &[u8; 32], nonce: &[u8; 16]) -> Result<Vec<u8>, EngineError> {
    let parts = children(whole(reply, SEQUENCE)?.content)?;
    let status = parts.first().filter(|status| status.tag == SEQUENCE).ok_or_else(|| wrong("no status"))?;
    let said = children(status.content)?;
    let code = said.first().filter(|code| code.tag == INTEGER).ok_or_else(|| wrong("no status"))?;
    // 0: granted; 1: granted, with changes.
    if !matches!(code.content, [0] | [1]) {
        // What the authority says of why, when it says it in words.
        let words: Vec<String> = said
            .get(1)
            .filter(|text| text.tag == SEQUENCE)
            .map(|text| children(text.content).unwrap_or_default().iter().map(|line| String::from_utf8_lossy(line.content).into_owned()).collect())
            .unwrap_or_default();
        return Err(EngineError::Failed(format!("the time-stamping authority refused the request{}", if words.is_empty() { String::new() } else { format!(": {}", words.join(" ")) })));
    }
    let token = parts.get(1).filter(|token| token.tag == SEQUENCE).ok_or_else(|| wrong("the answer holds no time stamp"))?;
    let stamp = said_by(token.whole)?;
    if stamp.digest != digest {
        return Err(wrong("it is of another fingerprint"));
    }
    if stamp.nonce != Some(strip(nonce)) {
        return Err(wrong("it is the answer to another request"));
    }
    Ok(token.whole.to_vec())
}

/// An INTEGER as DER keeps it: the leading zeros a positive number does not need are not written.
fn strip(number: &[u8]) -> &[u8] {
    let mut rest = number;
    while rest.len() > 1 && rest[0] == 0 && rest[1] < 0x80 {
        rest = &rest[1..];
    }
    rest
}

/// What a time stamp says (its `TSTInfo`).
struct Stamp<'a> {
    digest: &'a [u8],
    /// When, as the authority wrote it: `20261021203045Z`, maybe with parts of a second.
    time: &'a [u8],
    nonce: Option<&'a [u8]>,
}

/// The time stamp's own content: `ContentInfo { signedData { …, encapContentInfo { TSTInfo } } }`.
fn said_by(token: &[u8]) -> Result<Stamp<'_>, EngineError> {
    let info = children(whole(token, SEQUENCE)?.content)?;
    match info.as_slice() {
        [kind, held] if kind.tag == OBJECT && kind.content == SIGNED_DATA && held.tag == FIRST => {}
        _ => return Err(wrong("it is not signed data")),
    }
    let signed = children(whole(info[1].content, SEQUENCE)?.content)?;
    // version, digestAlgorithms, then what is signed.
    let held = signed.get(2).filter(|held| held.tag == SEQUENCE).ok_or_else(|| wrong("nothing is signed"))?;
    let held = children(held.content)?;
    match held.as_slice() {
        [kind, content] if kind.tag == OBJECT && kind.content == TST_INFO && content.tag == FIRST => {}
        _ => return Err(wrong("it holds no time")),
    }
    let octets = whole(held[1].content, OCTET_STRING)?;
    let fields = children(whole(octets.content, SEQUENCE)?.content)?;
    // version, policy, messageImprint, serialNumber, genTime, then what may be there: accuracy, ordering, nonce…
    let imprint = fields.get(2).filter(|imprint| imprint.tag == SEQUENCE).ok_or_else(|| wrong("no fingerprint"))?;
    let imprint = children(imprint.content)?;
    let digest = imprint.get(1).filter(|digest| digest.tag == OCTET_STRING).ok_or_else(|| wrong("no fingerprint"))?.content;
    let algorithm = imprint.first().map(|algorithm| children(algorithm.content)).transpose()?.unwrap_or_default();
    if algorithm.first().is_none_or(|name| name.content != SHA256) {
        return Err(wrong("the fingerprint is not SHA-256"));
    }
    let time = fields.get(4).filter(|time| time.tag == GENERALIZED_TIME).ok_or_else(|| wrong("no time"))?.content;
    let nonce = fields.iter().skip(5).find(|field| field.tag == INTEGER).map(|nonce| nonce.content);
    Ok(Stamp { digest, time, nonce })
}

/// When a time stamp says the fingerprint existed, as PDF writes moments (`D:20261021203045Z`); `None` when it is no time stamp.
pub fn time_of(token: &[u8]) -> Option<String> {
    let time = said_by(token).ok()?.time;
    let digits = time.get(..14).filter(|digits| digits.iter().all(u8::is_ascii_digit))?;
    time.ends_with(b"Z").then(|| format!("D:{}Z", String::from_utf8_lossy(digits)))
}

/// The parts of a signature (a CMS message) down to its first signer: `ContentInfo`, `SignedData` and the signer's own.
struct Signed<'a> {
    /// What comes before the signers in `SignedData`, the signers after the first, and the first signer's fields.
    before_signers: Vec<Element<'a>>,
    other_signers: Vec<Element<'a>>,
    signer: Vec<Element<'a>>,
    kind: Element<'a>,
}

fn signed_parts(cms: &[u8]) -> Result<Signed<'_>, EngineError> {
    let info = children(whole(cms, SEQUENCE)?.content)?;
    match info.as_slice() {
        [kind, held] if kind.tag == OBJECT && kind.content == SIGNED_DATA && held.tag == FIRST => {}
        _ => return Err(wrong("the signature is not signed data")),
    }
    let mut fields = children(whole(info[1].content, SEQUENCE)?.content)?;
    let signers = fields.pop().filter(|signers| signers.tag == SET).ok_or_else(|| wrong("the signature has no signer"))?;
    let mut signers = children(signers.content)?;
    if signers.is_empty() {
        return Err(wrong("the signature has no signer"));
    }
    let first = signers.remove(0);
    Ok(Signed { before_signers: fields, other_signers: signers, signer: children(first.content)?, kind: info[0] })
}

/// The certificates a signature or a time stamp carries (in `SignedData`), each as it is encoded.
pub fn certificates_in(cms: &[u8]) -> Vec<Vec<u8>> {
    let Ok(parts) = signed_parts(cms) else {
        return Vec::new();
    };
    // version, digestAlgorithms, encapContentInfo, then `[0] IMPLICIT` certificates when there are any.
    parts
        .before_signers
        .iter()
        .find(|field| field.tag == FIRST)
        .and_then(|held| children(held.content).ok())
        .map(|held| held.iter().filter(|certificate| certificate.tag == SEQUENCE).map(|certificate| certificate.whole.to_vec()).collect())
        .unwrap_or_default()
}

/// The signature value of a signature's first signer: what its time stamp is a stamp of.
pub fn signature_value(cms: &[u8]) -> Result<Vec<u8>, EngineError> {
    let parts = signed_parts(cms)?;
    // version, sid, digestAlgorithm, signedAttrs, signatureAlgorithm, signature: the only OCTET STRING among them.
    Ok(parts.signer.iter().find(|field| field.tag == OCTET_STRING).ok_or_else(|| wrong("the signer has no signature"))?.content.to_vec())
}

/// The signature with `token` kept in its first signer, among the attributes that are not signed.
pub fn with_token(cms: &[u8], token: &[u8]) -> Result<Vec<u8>, EngineError> {
    let parts = signed_parts(cms)?;
    let attribute = encoded(SEQUENCE, &joined(&[&encoded(OBJECT, SIGNATURE_TIME_STAMP), &encoded(SET, token)]));
    let mut signer: Vec<u8> = Vec::new();
    let mut kept = false;
    for field in &parts.signer {
        if field.tag == SECOND {
            // Attributes it has already: the new one goes with them. One time stamp is enough: an older one goes.
            let mut attributes: Vec<u8> = Vec::new();
            for existing in children(field.content)? {
                let names_stamp = children(existing.content)?.first().is_some_and(|name| name.tag == OBJECT && name.content == SIGNATURE_TIME_STAMP);
                if !names_stamp {
                    attributes.extend_from_slice(existing.whole);
                }
            }
            attributes.extend(&attribute);
            signer.extend(encoded(SECOND, &attributes));
            kept = true;
        } else {
            signer.extend_from_slice(field.whole);
        }
    }
    if !kept {
        signer.extend(encoded(SECOND, &attribute));
    }
    let mut signers = encoded(SEQUENCE, &signer);
    for other in &parts.other_signers {
        signers.extend_from_slice(other.whole);
    }
    let mut signed: Vec<u8> = Vec::new();
    for field in &parts.before_signers {
        signed.extend_from_slice(field.whole);
    }
    signed.extend(encoded(SET, &signers));
    let held = encoded(FIRST, &encoded(SEQUENCE, &signed));
    Ok(encoded(SEQUENCE, &joined(&[parts.kind.whole, &held])))
}

/// The time stamp a signature keeps in its first signer, if it has one.
pub fn token_in(cms: &[u8]) -> Option<Vec<u8>> {
    let parts = signed_parts(cms).ok()?;
    let attributes = parts.signer.iter().find(|field| field.tag == SECOND)?;
    for attribute in children(attributes.content).ok()? {
        let fields = children(attribute.content).ok()?;
        if let [name, values] = fields.as_slice() {
            if name.tag == OBJECT && name.content == SIGNATURE_TIME_STAMP && values.tag == SET {
                return children(values.content).ok()?.first().map(|token| token.whole.to_vec());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_for_a_fingerprint_with_its_number() {
        let digest = [7_u8; 32];
        let asked = query(&digest, &nonce(u128::MAX));
        let fields = children(whole(&asked, SEQUENCE).expect("one sequence").content).expect("fields");
        assert_eq!(fields.len(), 4);
        assert_eq!(fields[0].content, [1]);
        let imprint = children(fields[1].content).expect("imprint");
        assert_eq!(imprint[1].content, digest);
        assert!(fields[2].content[0] < 0x80 && fields[2].content[0] > 0, "a positive number without a leading zero");
        assert_eq!(fields[3].whole, [0x01, 0x01, 0xFF], "the authority's certificate is asked for");
    }

    #[test]
    fn writes_lengths_as_der_does() {
        assert_eq!(encoded(OCTET_STRING, &[]), [4, 0]);
        assert_eq!(encoded(OCTET_STRING, &[0; 127])[..2], [4, 127]);
        assert_eq!(encoded(OCTET_STRING, &[0; 128])[..3], [4, 0x81, 128]);
        assert_eq!(encoded(OCTET_STRING, &[0; 300])[..4], [4, 0x82, 1, 44]);
        let long = encoded(OCTET_STRING, &[9; 300]);
        let (read, rest) = element(&long).expect("reads");
        assert_eq!((read.content.len(), rest.len()), (300, 0));
    }

    #[test]
    fn refuses_what_is_not_der() {
        assert!(element(&[0x30, 0x80, 0, 0]).is_err(), "open-ended length");
        assert!(element(&[0x30, 5, 1]).is_err(), "too short");
        assert!(token_of(&[1, 2, 3], &[0; 32], &nonce(1)).is_err());
        assert!(signature_value(&[0x30, 0]).is_err());
    }
}
