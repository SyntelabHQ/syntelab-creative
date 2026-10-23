//! X.509 certificates read: who they name, who signed them, when they hold, their key, what they may be used for,
//! the names they stand for, where their status is asked, and their fingerprints.
//!
//! What is given is PEM (as many certificates as it holds, with whatever stands around them) or one certificate in
//! DER. The certificates are read by the `x509-parser` crate. They are only read: whether a certificate is to be
//! trusted (its chain, its signature, whether it was revoked) is not checked here, and nothing is fetched.

use std::io::Write;
use std::net::{Ipv4Addr, Ipv6Addr};

use sha1::Sha1;
use sha2::{Digest, Sha256};
use x509_parser::extensions::{DistributionPointName, GeneralName, ParsedExtension};
use x509_parser::objects::{oid2sn, oid_registry};
use x509_parser::pem::Pem;
use x509_parser::prelude::{FromDer, X509Certificate};
use x509_parser::public_key::PublicKey;
use x509_parser::time::ASN1Time;

use crate::codec::{CodecError, Wrong};
use crate::generate::moment;
use crate::json::{Options, Style};
use crate::lines::{list, object, plain, text, Members};
use crate::tree::{self, Node};

fn hex(bytes: &[u8], between: &str) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect::<Vec<_>>().join(between)
}

/// A name of an object as it is commonly written (`sha256WithRSAEncryption`), with its numbers when it has none.
fn named(oid: &x509_parser::der_parser::oid::Oid) -> String {
    oid2sn(oid, oid_registry()).map(str::to_owned).unwrap_or_else(|_| oid.to_id_string())
}

/// A name a certificate stands for, or an address it points to, as its kind and what it says.
fn general(name: &GeneralName) -> String {
    match name {
        GeneralName::DNSName(dns) => format!("DNS: {dns}"),
        GeneralName::RFC822Name(mail) => format!("email: {mail}"),
        GeneralName::URI(uri) => format!("URI: {uri}"),
        GeneralName::IPAddress(bytes) => match bytes.len() {
            4 => format!("IP: {}", Ipv4Addr::new(bytes[0], bytes[1], bytes[2], bytes[3])),
            16 => format!("IP: {}", Ipv6Addr::from(<[u8; 16]>::try_from(*bytes).unwrap_or_default())),
            _ => format!("IP: {}", hex(bytes, ":")),
        },
        GeneralName::DirectoryName(directory) => format!("directory: {directory}"),
        GeneralName::RegisteredID(oid) => format!("id: {}", oid.to_id_string()),
        other => format!("{other:?}"),
    }
}

fn time(time: ASN1Time) -> Node {
    text(&moment(time.timestamp().max(0) as u64, 0))
}

/// What a certificate says, as the members of a JSON object. `der`: the bytes it was read from, for its fingerprints.
fn told(certificate: &X509Certificate, der: &[u8], now: i64) -> Members {
    let validity = certificate.validity();
    let (from, until) = (validity.not_before.timestamp(), validity.not_after.timestamp());
    let key = certificate.public_key();
    let (kind, bits) = match key.parsed() {
        Ok(PublicKey::RSA(rsa)) => ("RSA".to_owned(), rsa.key_size()),
        Ok(PublicKey::EC(point)) => ("EC".to_owned(), point.key_size()),
        Ok(PublicKey::DSA(y)) => ("DSA".to_owned(), y.len() * 8),
        _ => (named(&key.algorithm.algorithm), key.subject_public_key.data.len() * 8),
    };
    let mut members: Members = vec![
        ("subject", text(&certificate.subject().to_string())),
        ("issuer", text(&certificate.issuer().to_string())),
        ("selfSigned", plain(certificate.subject().as_raw() == certificate.issuer().as_raw())),
        ("serial", text(&hex(certificate.raw_serial(), ":"))),
        ("version", plain(certificate.version().0 + 1)),
        ("notBefore", time(validity.not_before)),
        ("notAfter", time(validity.not_after)),
        ("validNow", plain(now >= from && now <= until)),
        ("daysLeft", plain((until - now).div_euclid(86_400))),
        ("signatureAlgorithm", text(&named(&certificate.signature_algorithm.algorithm))),
        ("publicKey", object(vec![("algorithm", text(&kind)), ("bits", plain(bits))])),
    ];
    let mut listed: Vec<Node> = Vec::new();
    for extension in certificate.extensions() {
        listed.push(object(vec![("id", text(&extension.oid.to_id_string())), ("name", text(&named(&extension.oid))), ("critical", plain(extension.critical))]));
        match extension.parsed_extension() {
            ParsedExtension::SubjectAlternativeName(names) => members.push(("alternativeNames", list(names.general_names.iter().map(|name| text(&general(name)))))),
            ParsedExtension::KeyUsage(usage) => {
                let uses = [
                    (usage.digital_signature(), "digitalSignature"),
                    (usage.non_repudiation(), "nonRepudiation"),
                    (usage.key_encipherment(), "keyEncipherment"),
                    (usage.data_encipherment(), "dataEncipherment"),
                    (usage.key_agreement(), "keyAgreement"),
                    (usage.key_cert_sign(), "keyCertSign"),
                    (usage.crl_sign(), "cRLSign"),
                    (usage.encipher_only(), "encipherOnly"),
                    (usage.decipher_only(), "decipherOnly"),
                ];
                members.push(("keyUsage", list(uses.iter().filter(|(set, _)| *set).map(|(_, name)| text(name)))));
            }
            ParsedExtension::ExtendedKeyUsage(usage) => {
                let uses = [(usage.any, "any"), (usage.server_auth, "serverAuth"), (usage.client_auth, "clientAuth"), (usage.code_signing, "codeSigning"), (usage.email_protection, "emailProtection"), (usage.time_stamping, "timeStamping"), (usage.ocsp_signing, "OCSPSigning")];
                let known = uses.iter().filter(|(set, _)| *set).map(|(_, name)| text(name));
                members.push(("extendedKeyUsage", list(known.chain(usage.other.iter().map(|oid| text(&oid.to_id_string()))))));
            }
            ParsedExtension::BasicConstraints(constraints) => {
                members.push(("isAuthority", plain(constraints.ca)));
                if let Some(length) = constraints.path_len_constraint {
                    members.push(("pathLength", plain(length)));
                }
            }
            ParsedExtension::SubjectKeyIdentifier(identifier) => members.push(("subjectKeyId", text(&hex(identifier.0, ":")))),
            ParsedExtension::AuthorityKeyIdentifier(authority) => {
                if let Some(identifier) = &authority.key_identifier {
                    members.push(("authorityKeyId", text(&hex(identifier.0, ":"))));
                }
            }
            ParsedExtension::AuthorityInfoAccess(access) => {
                // Where the status of the certificate is asked (OCSP), and where its issuer's certificate is.
                let of = |method: &str| list(access.accessdescs.iter().filter(|one| one.access_method.to_id_string() == method).map(|one| text(&general(&one.access_location))));
                members.push(("ocsp", of("1.3.6.1.5.5.7.48.1")));
                members.push(("issuerCertificates", of("1.3.6.1.5.5.7.48.2")));
            }
            ParsedExtension::CRLDistributionPoints(points) => {
                let names = points.points.iter().filter_map(|point| match &point.distribution_point {
                    Some(DistributionPointName::FullName(names)) => Some(names),
                    _ => None,
                });
                members.push(("crl", list(names.flatten().map(|name| text(&general(name))))));
            }
            _ => {}
        }
    }
    members.push(("extensions", Node::Array(listed)));
    members.push(("fingerprints", object(vec![("sha256", text(&hex(&Sha256::digest(der), ":"))), ("sha1", text(&hex(&Sha1::digest(der), ":")))])));
    members
}

/// The certificates in what is given, each as a JSON object. `now`: the moment their validity is told for, in
/// seconds since 1970.
pub fn read(bytes: &[u8], now: i64) -> Result<Vec<Node>, &'static str> {
    let mut found = Vec::new();
    // PEM: every certificate between its lines, whatever stands around them.
    if bytes.windows(10).any(|window| window == b"-----BEGIN") {
        for pem in Pem::iter_from_buffer(bytes) {
            let pem = pem.map_err(|_| "bad-pem")?;
            if !pem.label.contains("CERTIFICATE") || pem.label.contains("REQUEST") {
                continue;
            }
            let (_, certificate) = X509Certificate::from_der(&pem.contents).map_err(|_| "bad-certificate")?;
            found.push(object(told(&certificate, &pem.contents, now)));
        }
        return if found.is_empty() { Err("no-certificate") } else { Ok(found) };
    }
    // DER: one certificate, and nothing after it.
    let (rest, certificate) = X509Certificate::from_der(bytes).map_err(|_| "bad-certificate")?;
    let der = &bytes[..bytes.len() - rest.len()];
    Ok(vec![object(told(&certificate, der, now))])
}

/// A stage that holds what it is given (certificates are small) and writes what its certificates say.
pub struct Certificates {
    held: Vec<u8>,
    style: Style,
    found: usize,
}

impl Certificates {
    pub fn new(style: Style) -> Self {
        Certificates { held: Vec::new(), style, found: 0 }
    }
}

impl crate::codec::Stage for Certificates {
    fn push(&mut self, piece: &[u8], _out: &mut dyn Write) -> Result<(), CodecError> {
        if self.held.try_reserve(piece.len()).is_err() {
            return Err(CodecError::NoMemory);
        }
        self.held.extend_from_slice(piece);
        Ok(())
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        if self.held.iter().all(u8::is_ascii_whitespace) {
            return Err(Wrong::nowhere("empty").into());
        }
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |since| since.as_secs() as i64);
        let certificates = read(&self.held, now).map_err(Wrong::nowhere)?;
        self.found = certificates.len();
        tree::write(&Node::Array(certificates), out, &tree::Writing { options: Options::of(self.style), one_line_within: 0 })?;
        Ok(())
    }

    fn notes(&self) -> Vec<(&'static str, String)> {
        vec![("certificates-read", self.found.to_string())]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::{problem, through};
    use crate::codec::Stage;

    /// Made for this test with `openssl req -x509` (a key thrown away at once): a certificate that signs itself,
    /// for dev.example.test, with every extension the tool tells of.
    const PEM: &str = include_str!("../fixtures/certificate.pem");

    fn member<'a>(node: &'a Node, name: &str) -> &'a Node {
        match node {
            Node::Object(members) => members.iter().find(|(key, _)| **key == format!("\"{name}\"")).map(|(_, value)| value).expect("a member"),
            _ => panic!("no object"),
        }
    }

    fn said(node: &Node) -> String {
        String::from_utf8(crate::whole::json_text(node, 4, Options::of(Style::Minify)).expect("text")).expect("text")
    }

    #[test]
    fn a_certificate_is_read_as_openssl_reads_it() {
        // 2026-12-01: within its year.
        let certificates = read(PEM.as_bytes(), 1_796_083_200).expect("read");
        let certificate = &certificates[0];
        assert_eq!(certificates.len(), 1);
        assert_eq!(said(member(certificate, "subject")), "\"C=RO, O=Syntelab Test, CN=dev.example.test\"");
        assert_eq!((said(member(certificate, "selfSigned")), said(member(certificate, "serial")), said(member(certificate, "version"))), ("true".into(), "\"1a:2b:3c\"".into(), "3".into()));
        assert_eq!((said(member(certificate, "notBefore")), said(member(certificate, "notAfter"))), ("\"2026-10-11T21:22:35.000Z\"".into(), "\"2027-10-11T21:22:35.000Z\"".into()));
        assert_eq!((said(member(certificate, "validNow")), said(member(certificate, "daysLeft"))), ("true".into(), "314".into()));
        assert_eq!(said(member(certificate, "signatureAlgorithm")), "\"sha256WithRSAEncryption\"");
        assert_eq!(said(member(certificate, "publicKey")), r#"{"algorithm":"RSA","bits":2048}"#);
        assert_eq!(said(member(certificate, "alternativeNames")), r#"["DNS: dev.example.test","DNS: *.example.test","IP: 127.0.0.1","email: dev@example.test","URI: https://example.test/id"]"#);
        assert_eq!(said(member(certificate, "keyUsage")), r#"["digitalSignature","keyEncipherment"]"#);
        assert_eq!(said(member(certificate, "extendedKeyUsage")), r#"["serverAuth","clientAuth"]"#);
        assert_eq!((said(member(certificate, "ocsp")), said(member(certificate, "issuerCertificates")), said(member(certificate, "crl"))), (r#"["URI: http://ocsp.example.test"]"#.into(), r#"["URI: http://ca.example.test/ca.crt"]"#.into(), r#"["URI: http://crl.example.test/ca.crl"]"#.into()));
        // What `openssl x509 -fingerprint` gives for it.
        assert_eq!(said(member(certificate, "fingerprints")), r#"{"sha256":"28:cb:2c:4e:06:e9:37:ea:37:83:8d:92:9b:5d:5e:ec:7d:ef:7f:20:82:b8:60:9d:6b:27:51:da:e0:fe:3b:b1","sha1":"31:50:b1:33:82:28:c1:7a:ab:44:75:f4:ec:4c:2c:1e:5f:1b:d8:21"}"#);
        assert!(said(member(certificate, "extensions")).contains(r#"{"id":"2.5.29.15","name":"keyUsage","critical":true}"#));
        // After its year it holds no longer.
        let late = read(PEM.as_bytes(), 1_900_000_000).expect("read");
        assert_eq!(said(member(&late[0], "validNow")), "false");
    }

    #[test]
    fn several_in_one_paste_and_one_in_der() {
        let twice = format!("some words before\n{PEM}\nand between\n{PEM}");
        let mut stage = Certificates::new(Style::Minify);
        let out = through(&mut stage, twice.as_bytes(), 100).expect("read");
        assert_eq!((stage.notes(), out.starts_with(b"[{\"subject\"")), (vec![("certificates-read", "2".to_string())], true));
        // The same certificate in DER: its fingerprints are the same.
        let body: String = PEM.lines().filter(|line| !line.starts_with("-----")).collect();
        let der = through(&mut crate::base64::Decode::default(), body.as_bytes(), 64).expect("DER");
        let from_der = read(&der, 0).expect("read");
        assert_eq!(said(member(&from_der[0], "fingerprints")), said(member(&read(PEM.as_bytes(), 0).expect("read")[0], "fingerprints")));
    }

    #[test]
    fn what_is_no_certificate_is_told() {
        let wrong = |bytes: &[u8]| problem(through(&mut Certificates::new(Style::Minify), bytes, 50)).0;
        assert_eq!(wrong(b"not a certificate"), "bad-certificate");
        assert_eq!(wrong(b"-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n"), "no-certificate");
        assert_eq!(wrong(b"-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"), "bad-certificate");
        assert_eq!(wrong(b"  \n"), "empty");
    }
}
