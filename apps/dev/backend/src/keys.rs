//! Keys and certificates: made, read, and written in the forms programs take.
//!
//! - Keys: RSA (of any size the user asks for), the NIST curves P-256, P-384 and P-521, and Ed25519. A key is
//!   written as PKCS #8 (plain, or locked with a passphrase), in the older form of its kind (PKCS #1 for RSA,
//!   SEC 1 for the curves), and as OpenSSH writes keys; its public half as SubjectPublicKeyInfo and as the line
//!   OpenSSH puts in `authorized_keys`.
//! - Requests for a certificate (PKCS #10) and certificates signed by their own key, with the names they are for.
//! - Whatever is given is read by what it is, not by what its file is called: PEM with one thing or several, DER,
//!   an OpenSSH key, a PKCS #12 file (.pfx, .p12). What was read is written again in the other forms.
//!
//! Nothing here is kept, logged or sent anywhere: a key lives in memory for the call that asked for it. The random
//! numbers are those of the operating system.

use std::net::IpAddr;
use std::str::FromStr;
use std::time::{Duration, SystemTime};

use der::asn1::{Any, BitString, Ia5String, OctetString, SetOfVec};
use der::oid::{AssociatedOid, ObjectIdentifier};
use der::{Decode, Encode, Tag};
use pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey, LineEnding};
use rand_core::{OsRng, RngCore};
use rsa::pkcs1::{DecodeRsaPrivateKey, DecodeRsaPublicKey, EncodeRsaPrivateKey};
use rsa::signature::{SignatureEncoding, Signer};
use rsa::traits::PublicKeyParts;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use spki::{AlgorithmIdentifierOwned, SubjectPublicKeyInfoOwned};
use x509_cert::attr::{Attribute, AttributeTypeAndValue};
use x509_cert::ext::pkix::name::GeneralName;
use x509_cert::ext::pkix::{BasicConstraints, ExtendedKeyUsage, KeyUsage, KeyUsages, SubjectAltName, SubjectKeyIdentifier};
use x509_cert::ext::Extension;
use x509_cert::name::{Name, RdnSequence, RelativeDistinguishedName};
use x509_cert::request::{CertReq, CertReqInfo, ExtensionReq};
use x509_cert::serial_number::SerialNumber;
use x509_cert::time::{Time, Validity};
use x509_cert::{Certificate, TbsCertificate};

/// What went wrong, by a code the interface has words for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeysError(pub &'static str);

type Result<T> = std::result::Result<T, KeysError>;

/// Whatever a library says is wrong with what it was given comes to one code: what was given is not what was asked for.
fn failed<E>(_: E) -> KeysError {
    KeysError("failed")
}

fn unread<E>(_: E) -> KeysError {
    KeysError("not-recognized")
}

const RSA_ENCRYPTION: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.1");
const EC_PUBLIC_KEY: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.2.1");
const ED25519: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.101.112");
const PRIME256V1: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.3.1.7");
const SECP384R1: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.132.0.34");
const SECP521R1: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.132.0.35");
const SHA256_WITH_RSA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.11");
const ECDSA_WITH_SHA256: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.4.3.2");
const ECDSA_WITH_SHA384: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.4.3.3");
const ECDSA_WITH_SHA512: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.4.3.4");
const SERVER_AUTH: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.6.1.5.5.7.3.1");
const CLIENT_AUTH: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.6.1.5.5.7.3.2");

/// The kind of key to make.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Rsa(usize),
    P256,
    P384,
    P521,
    Ed25519,
}

/// The smallest RSA key that is made: below it a key is no protection.
pub const RSA_LEAST: usize = 1024;

/// How many times the passphrase of a locked PKCS #8 key is hashed: what is advised for PBKDF2 with SHA-256.
const LOCK_ROUNDS: u32 = 600_000;

/// A key of a curve in the older form (SEC 1), with the name of its curve written in it: OpenSSL reads no other.
fn sec1_pem(curve: ObjectIdentifier, private: &[u8], public: &[u8]) -> Result<String> {
    let der = sec1::EcPrivateKey { private_key: private, parameters: Some(sec1::EcParameters::NamedCurve(curve)), public_key: Some(public) }.to_der().map_err(failed)?;
    Ok(pem("EC PRIVATE KEY", &der))
}

/// A private key.
pub enum Key {
    Rsa(Box<rsa::RsaPrivateKey>),
    P256(p256::SecretKey),
    P384(p384::SecretKey),
    P521(p521::SecretKey),
    Ed25519(Box<ed25519_dalek::SigningKey>),
}

/// The public half of a key.
pub enum Public {
    Rsa(rsa::RsaPublicKey),
    P256(p256::PublicKey),
    P384(p384::PublicKey),
    P521(p521::PublicKey),
    Ed25519(ed25519_dalek::VerifyingKey),
}

impl Key {
    /// A new key, from the random numbers of the operating system.
    pub fn make(kind: Kind) -> Result<Key> {
        Ok(match kind {
            Kind::Rsa(bits) => {
                if bits < RSA_LEAST {
                    return Err(KeysError("rsa-too-small"));
                }
                Key::Rsa(Box::new(rsa::RsaPrivateKey::new(&mut OsRng, bits).map_err(failed)?))
            }
            Kind::P256 => Key::P256(p256::SecretKey::random(&mut OsRng)),
            Kind::P384 => Key::P384(p384::SecretKey::random(&mut OsRng)),
            Kind::P521 => Key::P521(p521::SecretKey::random(&mut OsRng)),
            Kind::Ed25519 => Key::Ed25519(Box::new(ed25519_dalek::SigningKey::generate(&mut OsRng))),
        })
    }

    pub fn public(&self) -> Public {
        match self {
            Key::Rsa(key) => Public::Rsa(key.to_public_key()),
            Key::P256(key) => Public::P256(key.public_key()),
            Key::P384(key) => Public::P384(key.public_key()),
            Key::P521(key) => Public::P521(key.public_key()),
            Key::Ed25519(key) => Public::Ed25519(key.verifying_key()),
        }
    }

    /// The key as PKCS #8, in DER.
    pub fn pkcs8(&self) -> Result<pkcs8::SecretDocument> {
        match self {
            Key::Rsa(key) => key.to_pkcs8_der(),
            Key::P256(key) => key.to_pkcs8_der(),
            Key::P384(key) => key.to_pkcs8_der(),
            Key::P521(key) => key.to_pkcs8_der(),
            // Without the public key (PKCS #8 v1, RFC 8410): OpenSSL 3.0, still the one of many systems, cannot read
            // the form that carries it (v2), neither alone nor inside a PKCS #12 file.
            Key::Ed25519(key) => ed25519_dalek::pkcs8::KeypairBytes { secret_key: key.to_bytes(), public_key: None }.to_pkcs8_der(),
        }
        .map_err(failed)
    }

    /// PKCS #8 as PEM: plain, or locked with a passphrase (PBES2: PBKDF2 with SHA-256, and AES-256).
    pub fn pkcs8_pem(&self, passphrase: Option<&str>) -> Result<String> {
        let plain = self.pkcs8()?;
        match passphrase {
            None => Ok(plain.to_pem("PRIVATE KEY", LineEnding::LF).map_err(failed)?.to_string()),
            Some(passphrase) => {
                // PBKDF2 with SHA-256, and AES-256: what OpenSSL writes by default, and so what every program opens.
                // (The library's own choice, scrypt, asks for more memory than OpenSSL lets a key take.)
                let (mut salt, mut iv) = ([0u8; 16], [0u8; 16]);
                OsRng.fill_bytes(&mut salt);
                OsRng.fill_bytes(&mut iv);
                let how = pkcs8::pkcs5::pbes2::Parameters::pbkdf2_sha256_aes256cbc(LOCK_ROUNDS, &salt, &iv).map_err(failed)?;
                let locked = pkcs8::PrivateKeyInfo::try_from(plain.as_bytes()).map_err(failed)?.encrypt_with_params(how, passphrase).map_err(failed)?;
                Ok(locked.to_pem("ENCRYPTED PRIVATE KEY", LineEnding::LF).map_err(failed)?.to_string())
            }
        }
    }

    /// The older form of its kind, as PEM: PKCS #1 for RSA, SEC 1 for the curves; Ed25519 has none.
    pub fn traditional_pem(&self) -> Result<Option<String>> {
        use p256::elliptic_curve::sec1::ToEncodedPoint;
        Ok(Some(match self {
            Key::Rsa(key) => key.to_pkcs1_pem(LineEnding::LF).map_err(failed)?.to_string(),
            Key::P256(key) => sec1_pem(PRIME256V1, &key.to_bytes(), key.public_key().to_encoded_point(false).as_bytes())?,
            Key::P384(key) => sec1_pem(SECP384R1, &key.to_bytes(), key.public_key().to_encoded_point(false).as_bytes())?,
            Key::P521(key) => sec1_pem(SECP521R1, &key.to_bytes(), key.public_key().to_encoded_point(false).as_bytes())?,
            Key::Ed25519(_) => return Ok(None),
        }))
    }

    /// The key as OpenSSH keeps it, with the words that are written after its public half.
    fn openssh(&self, comment: &str) -> Result<ssh_key::PrivateKey> {
        use ssh_key::private::{EcdsaKeypair, Ed25519Keypair, KeypairData, RsaKeypair};
        let data = match self {
            Key::Rsa(key) => KeypairData::Rsa(RsaKeypair::try_from(key.as_ref()).map_err(failed)?),
            Key::P256(key) => KeypairData::Ecdsa(EcdsaKeypair::NistP256 { public: key.public_key().into(), private: key.clone().into() }),
            Key::P384(key) => KeypairData::Ecdsa(EcdsaKeypair::NistP384 { public: key.public_key().into(), private: key.clone().into() }),
            Key::P521(key) => KeypairData::Ecdsa(EcdsaKeypair::NistP521 { public: key.public_key().into(), private: key.clone().into() }),
            Key::Ed25519(key) => KeypairData::Ed25519(Ed25519Keypair::from_seed(&key.to_bytes())),
        };
        ssh_key::PrivateKey::new(data, comment).map_err(failed)
    }

    /// The key file of OpenSSH: plain, or locked with a passphrase (bcrypt and AES-256).
    pub fn openssh_pem(&self, comment: &str, passphrase: Option<&str>) -> Result<String> {
        let key = self.openssh(comment)?;
        let key = match passphrase {
            Some(passphrase) => key.encrypt(&mut OsRng, passphrase).map_err(failed)?,
            None => key,
        };
        Ok(key.to_openssh(ssh_key::LineEnding::LF).map_err(failed)?.to_string())
    }

    /// Signs a message as certificates are signed with a key of this kind. Returns how, and the signature.
    fn sign(&self, message: &[u8]) -> Result<(AlgorithmIdentifierOwned, Vec<u8>)> {
        let plain = |oid| AlgorithmIdentifierOwned { oid, parameters: None };
        Ok(match self {
            Key::Rsa(key) => {
                let signer = rsa::pkcs1v15::SigningKey::<Sha256>::new(key.as_ref().clone());
                // RSA names its hash with a parameter that is NULL.
                (AlgorithmIdentifierOwned { oid: SHA256_WITH_RSA, parameters: Some(Any::new(Tag::Null, Vec::new()).map_err(failed)?) }, signer.sign(message).to_vec())
            }
            Key::P256(key) => {
                let signature: p256::ecdsa::Signature = p256::ecdsa::SigningKey::from(key).sign(message);
                (plain(ECDSA_WITH_SHA256), signature.to_der().as_bytes().to_vec())
            }
            Key::P384(key) => {
                let signature: p384::ecdsa::Signature = p384::ecdsa::SigningKey::from(key).sign(message);
                (plain(ECDSA_WITH_SHA384), signature.to_der().as_bytes().to_vec())
            }
            Key::P521(key) => {
                let signature: p521::ecdsa::Signature = p521::ecdsa::SigningKey::from_slice(&key.to_bytes()).map_err(failed)?.sign(message);
                (plain(ECDSA_WITH_SHA512), signature.to_der().as_bytes().to_vec())
            }
            Key::Ed25519(key) => (plain(ED25519), key.sign(message).to_bytes().to_vec()),
        })
    }
}

impl Public {
    /// SubjectPublicKeyInfo, in DER.
    pub fn spki(&self) -> Result<Vec<u8>> {
        Ok(match self {
            Public::Rsa(key) => key.to_public_key_der(),
            Public::P256(key) => key.to_public_key_der(),
            Public::P384(key) => key.to_public_key_der(),
            Public::P521(key) => key.to_public_key_der(),
            Public::Ed25519(key) => key.to_public_key_der(),
        }
        .map_err(failed)?
        .into_vec())
    }

    pub fn pem(&self) -> Result<String> {
        Ok(pem("PUBLIC KEY", &self.spki()?))
    }

    fn openssh(&self, comment: &str) -> Result<ssh_key::PublicKey> {
        use ssh_key::public::{EcdsaPublicKey, Ed25519PublicKey, KeyData, RsaPublicKey};
        let data = match self {
            Public::Rsa(key) => KeyData::Rsa(RsaPublicKey::try_from(key).map_err(failed)?),
            Public::P256(key) => KeyData::Ecdsa(EcdsaPublicKey::NistP256((*key).into())),
            Public::P384(key) => KeyData::Ecdsa(EcdsaPublicKey::NistP384((*key).into())),
            Public::P521(key) => KeyData::Ecdsa(EcdsaPublicKey::NistP521((*key).into())),
            Public::Ed25519(key) => KeyData::Ed25519(Ed25519PublicKey(key.to_bytes())),
        };
        Ok(ssh_key::PublicKey::new(data, comment))
    }

    /// The line OpenSSH puts in `authorized_keys`.
    pub fn openssh_line(&self, comment: &str) -> Result<String> {
        self.openssh(comment)?.to_openssh().map_err(failed)
    }

    /// The fingerprint OpenSSH shows for the key: `SHA256:…`.
    pub fn fingerprint(&self) -> Result<String> {
        Ok(self.openssh("")?.fingerprint(ssh_key::HashAlg::Sha256).to_string())
    }

    /// Its kind and its size, as they are said: `RSA`, 2048; `ECDSA P-256`, 256; `Ed25519`, 256.
    pub fn kind(&self) -> (&'static str, usize) {
        match self {
            Public::Rsa(key) => ("RSA", key.size() * 8),
            Public::P256(_) => ("ECDSA P-256", 256),
            Public::P384(_) => ("ECDSA P-384", 384),
            Public::P521(_) => ("ECDSA P-521", 521),
            Public::Ed25519(_) => ("Ed25519", 256),
        }
    }

    /// The SHA-256 of the SubjectPublicKeyInfo, in hexadecimal: the same for a key, its request and its certificate.
    pub fn digest(&self) -> Result<String> {
        Ok(hex(&Sha256::digest(self.spki()?)))
    }

    /// Checks a signature made with the private half of this key, in the way `algorithm` names. A way that is not
    /// checked here is told apart from a signature that is wrong.
    fn verify(&self, algorithm: &ObjectIdentifier, message: &[u8], signature: &[u8]) -> Result<()> {
        use rsa::signature::Verifier;
        const SHA384_WITH_RSA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.12");
        const SHA512_WITH_RSA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.13");
        let wrong = |_| KeysError("bad-signature");
        match (self, *algorithm) {
            (Public::Rsa(key), SHA256_WITH_RSA) => rsa::pkcs1v15::VerifyingKey::<Sha256>::new(key.clone()).verify(message, &rsa::pkcs1v15::Signature::try_from(signature).map_err(wrong)?).map_err(wrong),
            (Public::Rsa(key), SHA384_WITH_RSA) => rsa::pkcs1v15::VerifyingKey::<sha2::Sha384>::new(key.clone()).verify(message, &rsa::pkcs1v15::Signature::try_from(signature).map_err(wrong)?).map_err(wrong),
            (Public::Rsa(key), SHA512_WITH_RSA) => rsa::pkcs1v15::VerifyingKey::<sha2::Sha512>::new(key.clone()).verify(message, &rsa::pkcs1v15::Signature::try_from(signature).map_err(wrong)?).map_err(wrong),
            (Public::P256(key), ECDSA_WITH_SHA256) => p256::ecdsa::VerifyingKey::from(key).verify(message, &p256::ecdsa::Signature::from_der(signature).map_err(wrong)?).map_err(wrong),
            (Public::P384(key), ECDSA_WITH_SHA384) => p384::ecdsa::VerifyingKey::from(key).verify(message, &p384::ecdsa::Signature::from_der(signature).map_err(wrong)?).map_err(wrong),
            (Public::P521(key), ECDSA_WITH_SHA512) => p521::ecdsa::VerifyingKey::from_affine(*key.as_affine()).map_err(wrong)?.verify(message, &p521::ecdsa::Signature::from_der(signature).map_err(wrong)?).map_err(wrong),
            (Public::Ed25519(key), ED25519) => key.verify(message, &ed25519_dalek::Signature::from_slice(signature).map_err(wrong)?).map_err(wrong),
            _ => Err(KeysError("signature-not-checked")),
        }
    }

    fn from_spki(der: &[u8]) -> Result<Public> {
        let info = spki::SubjectPublicKeyInfoRef::try_from(der).map_err(unread)?;
        let curve = || info.algorithm.parameters_oid().map_err(unread);
        Ok(match info.algorithm.oid {
            RSA_ENCRYPTION => Public::Rsa(rsa::RsaPublicKey::from_public_key_der(der).map_err(unread)?),
            ED25519 => Public::Ed25519(ed25519_dalek::VerifyingKey::from_public_key_der(der).map_err(unread)?),
            EC_PUBLIC_KEY => match curve()? {
                PRIME256V1 => Public::P256(p256::PublicKey::from_public_key_der(der).map_err(unread)?),
                SECP384R1 => Public::P384(p384::PublicKey::from_public_key_der(der).map_err(unread)?),
                SECP521R1 => Public::P521(p521::PublicKey::from_public_key_der(der).map_err(unread)?),
                _ => return Err(KeysError("other-key")),
            },
            _ => return Err(KeysError("other-key")),
        })
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Bytes as PEM: Base64 in lines of 64 letters, between a line that begins and one that ends.
pub fn pem(label: &str, der: &[u8]) -> String {
    let encoded = crate::hash::base64(der);
    let mut text = format!("-----BEGIN {label}-----\n");
    for line in encoded.as_bytes().chunks(64) {
        text.push_str(std::str::from_utf8(line).unwrap_or_default());
        text.push('\n');
    }
    text.push_str(&format!("-----END {label}-----\n"));
    text
}

fn unbase64(text: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(text.len() * 3 / 4);
    let (mut bits, mut count) = (0u32, 0u8);
    for letter in text.bytes() {
        let value = match letter {
            b'A'..=b'Z' => letter - b'A',
            b'a'..=b'z' => letter - b'a' + 26,
            b'0'..=b'9' => letter - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\r' | b'\n' | b' ' | b'\t' => continue,
            _ => return None,
        };
        bits = bits << 6 | u32::from(value);
        count += 6;
        if count >= 8 {
            count -= 8;
            bytes.push((bits >> count) as u8);
        }
    }
    Some(bytes)
}

/// One block of a PEM text.
struct Block {
    label: String,
    der: Vec<u8>,
    /// As it was written, from its first line to its last: OpenSSH keys are read from this.
    text: String,
    /// Locked the way OpenSSL once locked keys (`Proc-Type: 4,ENCRYPTED`): the cipher its `DEK-Info` header names, and
    /// the bytes the locking began with.
    old_lock: Option<(String, Vec<u8>)>,
}

/// The blocks of a PEM text, in the order they are written.
fn blocks(text: &str) -> Vec<Block> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("-----BEGIN ") {
        let after = &rest[start + 11..];
        let Some(label_end) = after.find("-----") else { break };
        let label = after[..label_end].trim().to_owned();
        let closing = format!("-----END {label}-----");
        let Some(end) = after.find(&closing) else { break };
        let body = &after[label_end + 5..end];
        // Lines with a colon are headers, not Base64.
        let old_lock = (body.contains("ENCRYPTED") && body.contains("Proc-Type")).then(|| {
            let told = body.lines().find_map(|line| line.trim().strip_prefix("DEK-Info:")).unwrap_or_default();
            let (cipher, start) = told.split_once(',').unwrap_or((told, ""));
            let start = start.trim();
            let bytes = (0..start.len() / 2).filter_map(|index| u8::from_str_radix(start.get(index * 2..index * 2 + 2)?, 16).ok()).collect();
            (cipher.trim().to_ascii_uppercase(), bytes)
        });
        let base64: String = body.lines().filter(|line| !line.contains(':')).collect::<Vec<_>>().join("");
        if let Some(der) = unbase64(&base64) {
            found.push(Block { label, der, text: rest[start..start + 11 + end + closing.len()].to_owned(), old_lock });
        }
        rest = &after[end + closing.len()..];
    }
    found
}

/// Opens a key locked the way OpenSSL once locked keys: the block says how in its `DEK-Info` header (the cipher,
/// and the bytes the locking began with), and the key of the cipher is made from the passphrase with MD5.
fn unlock_old(block: &Block, passphrase: Option<&str>) -> Result<Vec<u8>> {
    use cbc::cipher::block_padding::Pkcs7;
    use cbc::cipher::{BlockDecryptMut, KeyIvInit};
    use md5::Md5;
    let passphrase = passphrase.filter(|passphrase| !passphrase.is_empty()).ok_or(KeysError("needs-passphrase"))?;
    let (cipher, start) = block.old_lock.as_ref().ok_or(KeysError("old-lock"))?;
    let key_length = match cipher.as_str() {
        "AES-128-CBC" => 16,
        "AES-192-CBC" | "DES-EDE3-CBC" => 24,
        "AES-256-CBC" => 32,
        _ => return Err(KeysError("old-lock")),
    };
    if start.len() < 8 {
        return Err(KeysError("old-lock"));
    }
    // The key: MD5 of the passphrase and the first eight bytes, then MD5 of that and the same again, until it is long enough.
    let mut key = Vec::new();
    let mut last = Vec::new();
    while key.len() < key_length {
        let mut hasher = Md5::new();
        hasher.update(&last);
        hasher.update(passphrase.as_bytes());
        hasher.update(&start[..8]);
        last = hasher.finalize().to_vec();
        key.extend_from_slice(&last);
    }
    key.truncate(key_length);
    let wrong = |_| KeysError("bad-passphrase");
    let failed_cipher = |_| KeysError("old-lock");
    match cipher.as_str() {
        "AES-128-CBC" => cbc::Decryptor::<aes::Aes128>::new_from_slices(&key, start).map_err(failed_cipher)?.decrypt_padded_vec_mut::<Pkcs7>(&block.der).map_err(wrong),
        "AES-192-CBC" => cbc::Decryptor::<aes::Aes192>::new_from_slices(&key, start).map_err(failed_cipher)?.decrypt_padded_vec_mut::<Pkcs7>(&block.der).map_err(wrong),
        "AES-256-CBC" => cbc::Decryptor::<aes::Aes256>::new_from_slices(&key, start).map_err(failed_cipher)?.decrypt_padded_vec_mut::<Pkcs7>(&block.der).map_err(wrong),
        _ => cbc::Decryptor::<des::TdesEde3>::new_from_slices(&key, start).map_err(failed_cipher)?.decrypt_padded_vec_mut::<Pkcs7>(&block.der).map_err(wrong),
    }
}

/// What was read from what was given.
#[derive(Default)]
pub struct Found {
    pub key: Option<Key>,
    /// A public key given by itself (not the half of a private one, which `key` has).
    pub public: Option<Public>,
    /// Certificates, in DER, in the order they were given.
    pub certificates: Vec<Vec<u8>>,
    /// Requests for a certificate, in DER.
    pub requests: Vec<Vec<u8>>,
    /// What it was read from, in words the interface has: `pem`, `der`, `openssh`, `pkcs12`.
    pub form: &'static str,
    /// The key was locked with a passphrase.
    pub locked: bool,
    /// The words written after an OpenSSH key.
    pub comment: String,
}

fn key_from_pkcs8(der: &[u8]) -> Result<Key> {
    let info = pkcs8::PrivateKeyInfo::try_from(der).map_err(unread)?;
    Ok(match info.algorithm.oid {
        RSA_ENCRYPTION => Key::Rsa(Box::new(rsa::RsaPrivateKey::from_pkcs8_der(der).map_err(unread)?)),
        ED25519 => Key::Ed25519(Box::new(ed25519_dalek::SigningKey::from_pkcs8_der(der).map_err(unread)?)),
        EC_PUBLIC_KEY => match info.algorithm.parameters_oid().map_err(unread)? {
            PRIME256V1 => Key::P256(p256::SecretKey::from_pkcs8_der(der).map_err(unread)?),
            SECP384R1 => Key::P384(p384::SecretKey::from_pkcs8_der(der).map_err(unread)?),
            SECP521R1 => Key::P521(p521::SecretKey::from_pkcs8_der(der).map_err(unread)?),
            _ => return Err(KeysError("other-key")),
        },
        _ => return Err(KeysError("other-key")),
    })
}

fn key_from_locked_pkcs8(der: &[u8], passphrase: Option<&str>) -> Result<Key> {
    let locked = pkcs8::EncryptedPrivateKeyInfo::try_from(der).map_err(unread)?;
    let passphrase = passphrase.filter(|passphrase| !passphrase.is_empty()).ok_or(KeysError("needs-passphrase"))?;
    let plain = locked.decrypt(passphrase).map_err(|_| KeysError("bad-passphrase"))?;
    key_from_pkcs8(plain.as_bytes())
}

fn key_from_sec1(der: &[u8]) -> Result<Key> {
    // The curve is written in the key; each is tried, and only its own reads it.
    if let Ok(key) = p256::SecretKey::from_sec1_der(der) {
        return Ok(Key::P256(key));
    }
    if let Ok(key) = p384::SecretKey::from_sec1_der(der) {
        return Ok(Key::P384(key));
    }
    p521::SecretKey::from_sec1_der(der).map(Key::P521).map_err(unread)
}

fn key_from_openssh(text: &str, passphrase: Option<&str>, found: &mut Found) -> Result<Key> {
    use ssh_key::private::{EcdsaKeypair, KeypairData};
    let key = ssh_key::PrivateKey::from_openssh(text).map_err(unread)?;
    let key = if key.is_encrypted() {
        found.locked = true;
        let passphrase = passphrase.filter(|passphrase| !passphrase.is_empty()).ok_or(KeysError("needs-passphrase"))?;
        key.decrypt(passphrase).map_err(|_| KeysError("bad-passphrase"))?
    } else {
        key
    };
    found.comment = key.comment().to_owned();
    Ok(match key.key_data() {
        KeypairData::Rsa(pair) => {
            // Put together here: the library's own way gives the first prime twice, and so reads no key.
            let number = |part: &ssh_key::Mpint| rsa::BigUint::try_from(part).map_err(unread);
            let primes = vec![number(&pair.private.p)?, number(&pair.private.q)?];
            Key::Rsa(Box::new(rsa::RsaPrivateKey::from_components(number(&pair.public.n)?, number(&pair.public.e)?, number(&pair.private.d)?, primes).map_err(unread)?))
        }
        KeypairData::Ed25519(pair) => Key::Ed25519(Box::new(ed25519_dalek::SigningKey::from_bytes(&pair.private.to_bytes()))),
        KeypairData::Ecdsa(EcdsaKeypair::NistP256 { private, .. }) => Key::P256(p256::SecretKey::from_slice(private.as_slice()).map_err(unread)?),
        KeypairData::Ecdsa(EcdsaKeypair::NistP384 { private, .. }) => Key::P384(p384::SecretKey::from_slice(private.as_slice()).map_err(unread)?),
        KeypairData::Ecdsa(EcdsaKeypair::NistP521 { private, .. }) => Key::P521(p521::SecretKey::from_slice(private.as_slice()).map_err(unread)?),
        _ => return Err(KeysError("other-key")),
    })
}

fn public_from_openssh(line: &str, found: &mut Found) -> Result<Public> {
    use ssh_key::public::{EcdsaPublicKey, KeyData};
    let key = ssh_key::PublicKey::from_openssh(line.trim()).map_err(unread)?;
    found.comment = key.comment().to_owned();
    Ok(match key.key_data() {
        KeyData::Rsa(key) => Public::Rsa(rsa::RsaPublicKey::try_from(key).map_err(unread)?),
        KeyData::Ed25519(key) => Public::Ed25519(ed25519_dalek::VerifyingKey::from_bytes(&key.0).map_err(unread)?),
        KeyData::Ecdsa(EcdsaPublicKey::NistP256(point)) => Public::P256(p256::PublicKey::from_sec1_bytes(point.as_bytes()).map_err(unread)?),
        KeyData::Ecdsa(EcdsaPublicKey::NistP384(point)) => Public::P384(p384::PublicKey::from_sec1_bytes(point.as_bytes()).map_err(unread)?),
        KeyData::Ecdsa(EcdsaPublicKey::NistP521(point)) => Public::P521(p521::PublicKey::from_sec1_bytes(point.as_bytes()).map_err(unread)?),
        _ => return Err(KeysError("other-key")),
    })
}

/// Reads whatever is given: PEM with one thing or several, an OpenSSH public key, or bytes in DER (a certificate,
/// a request, a key in any of its forms, a PKCS #12 file). `passphrase` opens a key that is locked, and a PKCS #12 file.
pub fn read(given: &[u8], passphrase: Option<&str>) -> Result<Found> {
    let mut found = Found::default();
    let text = std::str::from_utf8(given).ok().filter(|text| text.contains("-----BEGIN ") || text.trim_start().starts_with("ssh-") || text.trim_start().starts_with("ecdsa-"));
    if let Some(text) = text {
        let blocks = blocks(text);
        if blocks.is_empty() {
            found.form = "openssh";
            found.public = Some(public_from_openssh(text.lines().find(|line| !line.trim().is_empty()).unwrap_or_default(), &mut found)?);
            return Ok(found);
        }
        found.form = "pem";
        for mut block in blocks {
            if block.old_lock.is_some() {
                found.locked = true;
                block.der = unlock_old(&block, passphrase)?;
            }
            // A key that was opened with a wrong passphrase is no key: that is what is told.
            let opened = |read: Result<Key>| if block.old_lock.is_some() { read.map_err(|_| KeysError("bad-passphrase")) } else { read };
            match block.label.as_str() {
                "CERTIFICATE" | "X509 CERTIFICATE" | "TRUSTED CERTIFICATE" => {
                    Certificate::from_der(&block.der).map_err(unread)?;
                    found.certificates.push(block.der);
                }
                "CERTIFICATE REQUEST" | "NEW CERTIFICATE REQUEST" => {
                    CertReq::from_der(&block.der).map_err(unread)?;
                    found.requests.push(block.der);
                }
                "PUBLIC KEY" => found.public = Some(Public::from_spki(&block.der)?),
                "RSA PUBLIC KEY" => found.public = Some(Public::Rsa(rsa::RsaPublicKey::from_pkcs1_der(&block.der).map_err(unread)?)),
                "PRIVATE KEY" => found.key = Some(key_from_pkcs8(&block.der)?),
                "ENCRYPTED PRIVATE KEY" => {
                    found.locked = true;
                    found.key = Some(key_from_locked_pkcs8(&block.der, passphrase)?);
                }
                "RSA PRIVATE KEY" => found.key = Some(opened(rsa::RsaPrivateKey::from_pkcs1_der(&block.der).map(|key| Key::Rsa(Box::new(key))).map_err(unread))?),
                "EC PRIVATE KEY" => found.key = Some(opened(key_from_sec1(&block.der))?),
                "OPENSSH PRIVATE KEY" => {
                    found.form = "openssh";
                    found.key = Some(key_from_openssh(&block.text, passphrase, &mut found)?);
                }
                // What is no key and no certificate (parameters of a curve, a list of revoked certificates) is passed over.
                _ => {}
            }
        }
        if found.key.is_none() && found.public.is_none() && found.certificates.is_empty() && found.requests.is_empty() {
            return Err(KeysError("not-recognized"));
        }
        return Ok(found);
    }

    // Bytes: each thing they may be is tried, the most particular first.
    if is_pkcs12(given) {
        found.form = "pkcs12";
        found.locked = true;
        let store = p12_keystore::KeyStore::from_pkcs12(given, passphrase.unwrap_or_default()).map_err(|_| KeysError(if passphrase.is_some_and(|passphrase| !passphrase.is_empty()) { "bad-passphrase" } else { "needs-passphrase" }))?;
        for (_, entry) in store.entries() {
            match entry {
                p12_keystore::KeyStoreEntry::PrivateKeyChain(chain) => {
                    if found.key.is_none() {
                        found.key = Some(key_from_pkcs8(chain.key())?);
                    }
                    found.certificates.extend(chain.chain().iter().map(|certificate| certificate.as_der().to_vec()));
                }
                p12_keystore::KeyStoreEntry::Certificate(certificate) => found.certificates.push(certificate.as_der().to_vec()),
            }
        }
        return Ok(found);
    }
    found.form = "der";
    if Certificate::from_der(given).is_ok() {
        found.certificates.push(given.to_vec());
    } else if CertReq::from_der(given).is_ok() {
        found.requests.push(given.to_vec());
    } else if let Ok(key) = key_from_pkcs8(given) {
        found.key = Some(key);
    } else if pkcs8::EncryptedPrivateKeyInfo::try_from(given).is_ok() {
        found.locked = true;
        found.key = Some(key_from_locked_pkcs8(given, passphrase)?);
    } else if let Ok(key) = rsa::RsaPrivateKey::from_pkcs1_der(given) {
        found.key = Some(Key::Rsa(Box::new(key)));
    } else if let Ok(key) = key_from_sec1(given) {
        found.key = Some(key);
    } else if let Ok(public) = Public::from_spki(given) {
        found.public = Some(public);
    } else if let Ok(public) = rsa::RsaPublicKey::from_pkcs1_der(given) {
        found.public = Some(Public::Rsa(public));
    } else {
        return Err(KeysError("not-recognized"));
    }
    Ok(found)
}

/// A PKCS #12 file begins as a sequence whose first part is the number 3.
fn is_pkcs12(given: &[u8]) -> bool {
    let Some((&0x30, rest)) = given.split_first() else { return false };
    // The length of the sequence takes one byte, or one byte that says how many more.
    let skip = match rest.first() {
        Some(&first) if first < 0x80 => 1,
        Some(&first) => 1 + usize::from(first & 0x7f),
        None => return false,
    };
    rest.get(skip..skip + 3) == Some(&[0x02, 0x01, 0x03])
}

/// Whom a request or a certificate is for.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Subject {
    pub common_name: String,
    pub organization: String,
    pub unit: String,
    pub locality: String,
    pub state: String,
    /// Two letters.
    pub country: String,
    pub email: String,
}

impl Subject {
    fn name(&self) -> Result<Name> {
        const COUNTRY: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.6");
        const STATE: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.8");
        const LOCALITY: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.7");
        const ORGANIZATION: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.10");
        const UNIT: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.11");
        const COMMON_NAME: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.3");
        const EMAIL: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.1");
        let country = self.country.trim().to_ascii_uppercase();
        if !country.is_empty() && !(country.len() == 2 && country.bytes().all(|letter| letter.is_ascii_uppercase())) {
            return Err(KeysError("bad-country"));
        }
        if !self.email.trim().is_ascii() {
            return Err(KeysError("bad-email"));
        }
        // From the widest to the nearest, as names are written in certificates.
        let parts = [
            (COUNTRY, country.as_str(), Tag::PrintableString),
            (STATE, self.state.trim(), Tag::Utf8String),
            (LOCALITY, self.locality.trim(), Tag::Utf8String),
            (ORGANIZATION, self.organization.trim(), Tag::Utf8String),
            (UNIT, self.unit.trim(), Tag::Utf8String),
            (COMMON_NAME, self.common_name.trim(), Tag::Utf8String),
            (EMAIL, self.email.trim(), Tag::Ia5String),
        ];
        let mut names = Vec::new();
        for (oid, value, tag) in parts {
            if value.is_empty() {
                continue;
            }
            let part = AttributeTypeAndValue { oid, value: Any::new(tag, value.as_bytes()).map_err(failed)? };
            names.push(RelativeDistinguishedName(SetOfVec::try_from(vec![part]).map_err(failed)?));
        }
        Ok(RdnSequence(names))
    }
}

/// The other names a certificate is for: names of hosts, addresses, e-mail addresses, each told by how it is written.
fn other_names(names: &[String]) -> Result<Option<SubjectAltName>> {
    let mut general = Vec::new();
    for name in names.iter().map(|name| name.trim()).filter(|name| !name.is_empty()) {
        general.push(match IpAddr::from_str(name) {
            Ok(IpAddr::V4(address)) => GeneralName::IpAddress(OctetString::new(address.octets().to_vec()).map_err(failed)?),
            Ok(IpAddr::V6(address)) => GeneralName::IpAddress(OctetString::new(address.octets().to_vec()).map_err(failed)?),
            Err(_) if name.contains('@') => GeneralName::Rfc822Name(Ia5String::new(name).map_err(|_| KeysError("bad-name"))?),
            // A name of a host is letters, digits, hyphens and dots; a star may stand for its first part.
            Err(_) if name.bytes().all(|letter| letter.is_ascii_alphanumeric() || matches!(letter, b'-' | b'.' | b'*' | b'_')) => GeneralName::DnsName(Ia5String::new(name).map_err(|_| KeysError("bad-name"))?),
            Err(_) => return Err(KeysError("bad-name")),
        });
    }
    Ok((!general.is_empty()).then_some(SubjectAltName(general)))
}

fn extension<T: Encode + AssociatedOid>(value: &T, critical: bool) -> Result<Extension> {
    Ok(Extension { extn_id: T::OID, critical, extn_value: OctetString::new(value.to_der().map_err(failed)?).map_err(failed)? })
}

/// A request for a certificate (PKCS #10), signed with the key, in DER.
pub fn request(key: &Key, subject: &Subject, names: &[String]) -> Result<Vec<u8>> {
    let name = subject.name()?;
    let others = other_names(names)?;
    if name.0.is_empty() && others.is_none() {
        return Err(KeysError("no-subject"));
    }
    let mut attributes = SetOfVec::new();
    if let Some(others) = &others {
        let asked = ExtensionReq(vec![extension(others, name.0.is_empty())?]);
        let values = SetOfVec::try_from(vec![Any::encode_from(&asked).map_err(failed)?]).map_err(failed)?;
        attributes.insert(Attribute { oid: ExtensionReq::OID, values }).map_err(failed)?;
    }
    let info = CertReqInfo { version: x509_cert::request::Version::V1, subject: name, public_key: SubjectPublicKeyInfoOwned::from_der(&key.public().spki()?).map_err(failed)?, attributes };
    let (algorithm, signature) = key.sign(&info.to_der().map_err(failed)?)?;
    CertReq { info, algorithm, signature: BitString::from_bytes(&signature).map_err(failed)? }.to_der().map_err(failed)
}

/// A certificate signed with its own key, in DER. `days` is how long it holds from now; `authority` makes it one
/// that may sign other certificates (a root of one's own), else it is for a server and a client.
pub fn self_signed(key: &Key, subject: &Subject, names: &[String], days: u64, authority: bool) -> Result<Vec<u8>> {
    let name = subject.name()?;
    let others = other_names(names)?;
    if name.0.is_empty() && others.is_none() {
        return Err(KeysError("no-subject"));
    }
    let info = SubjectPublicKeyInfoOwned::from_der(&key.public().spki()?).map_err(failed)?;
    let others = others.as_ref().map(|others| extension(others, name.0.is_empty())).transpose()?;
    issue(key, &name, None, name.clone(), info, others, days, authority)
}

/// A certificate for `subject` and its key, signed with `signer` in the name of `issuer`, in DER. `authority_key`
/// is the public key of the one who signs when that is another (its bits, as its certificate has them): the
/// certificate then says whose key signed it.
#[allow(clippy::too_many_arguments)]
fn issue(signer: &Key, issuer: &Name, authority_key: Option<&[u8]>, subject: Name, info: SubjectPublicKeyInfoOwned, others: Option<Extension>, days: u64, authority: bool) -> Result<Vec<u8>> {
    use x509_cert::ext::pkix::AuthorityKeyIdentifier;
    // The clock of another machine may be a little behind: the certificate holds from five minutes ago.
    let now = SystemTime::now();
    let ends = now.checked_add(Duration::from_secs(days.checked_mul(86_400).ok_or(KeysError("bad-days"))?)).ok_or(KeysError("bad-days"))?;
    let validity = Validity { not_before: Time::try_from(now - Duration::from_secs(300)).map_err(failed)?, not_after: Time::try_from(ends).map_err(|_| KeysError("bad-days"))? };
    let mut serial = [0u8; 16];
    OsRng.fill_bytes(&mut serial);
    // A serial number is positive, and has no zero at its start.
    serial[0] = serial[0] & 0x7f | 0x01;

    let of_rsa = info.algorithm.oid == RSA_ENCRYPTION;
    let usage = if authority { KeyUsages::KeyCertSign | KeyUsages::CRLSign | KeyUsages::DigitalSignature } else if of_rsa { KeyUsages::DigitalSignature | KeyUsages::KeyEncipherment } else { KeyUsages::DigitalSignature.into() };
    let identifier = |bits: &[u8]| OctetString::new(sha1::Sha1::digest(bits).to_vec()).map_err(failed);
    let mut extensions = vec![
        extension(&BasicConstraints { ca: authority, path_len_constraint: None }, true)?,
        extension(&KeyUsage(usage), true)?,
        extension(&SubjectKeyIdentifier(identifier(info.subject_public_key.raw_bytes())?), false)?,
    ];
    if let Some(bits) = authority_key {
        extensions.push(extension(&AuthorityKeyIdentifier { key_identifier: Some(identifier(bits)?), authority_cert_issuer: None, authority_cert_serial_number: None }, false)?);
    }
    if !authority {
        extensions.push(extension(&ExtendedKeyUsage(vec![SERVER_AUTH, CLIENT_AUTH]), false)?);
    }
    extensions.extend(others);

    // How it is signed is written inside what is signed too: a first signature of nothing tells it.
    let (algorithm, _) = signer.sign(b"")?;
    let tbs = TbsCertificate {
        version: x509_cert::Version::V3,
        serial_number: SerialNumber::new(&serial).map_err(failed)?,
        signature: algorithm.clone(),
        issuer: issuer.clone(),
        validity,
        subject,
        subject_public_key_info: info,
        issuer_unique_id: None,
        subject_unique_id: None,
        extensions: Some(extensions),
    };
    let (_, signature) = signer.sign(&tbs.to_der().map_err(failed)?)?;
    Certificate { tbs_certificate: tbs, signature_algorithm: algorithm, signature: BitString::from_bytes(&signature).map_err(failed)? }.to_der().map_err(failed)
}

/// A request signed by an authority of one's own: a certificate for whom the request names and for its key, signed
/// with the key of the authority in the name its certificate has. The request must be signed by its own key (so
/// the one who asks holds it); the key must be that of the authority's certificate, which must be one that may
/// sign others. The other names the request asks for are kept. `authority` makes what is signed an authority too
/// (one between the root and the certificates of servers).
pub fn sign_request(authority_key: &Key, authority_certificate: &[u8], request: &[u8], days: u64, authority: bool) -> Result<Vec<u8>> {
    let signer = Certificate::from_der(authority_certificate).map_err(unread)?;
    if public_of_certificate(authority_certificate)?.digest()? != authority_key.public().digest()? {
        return Err(KeysError("key-mismatch"));
    }
    let may_sign = signer.tbs_certificate.extensions.iter().flatten().find(|extension| extension.extn_id == BasicConstraints::OID).and_then(|extension| BasicConstraints::from_der(extension.extn_value.as_bytes()).ok()).is_some_and(|constraints| constraints.ca);
    if !may_sign {
        return Err(KeysError("not-authority"));
    }
    let asked = CertReq::from_der(request).map_err(unread)?;
    let info = asked.info.public_key.clone();
    let public = Public::from_spki(&info.to_der().map_err(failed)?)?;
    public.verify(&asked.algorithm.oid, &asked.info.to_der().map_err(failed)?, asked.signature.raw_bytes())?;
    // The other names the request asks for, as it wrote them.
    let others = asked
        .info
        .attributes
        .iter()
        .filter(|attribute| attribute.oid == ExtensionReq::OID)
        .flat_map(|attribute| attribute.values.iter())
        .filter_map(|value| value.decode_as::<ExtensionReq>().ok())
        .flat_map(|asked| asked.0)
        .find(|extension| extension.extn_id == SubjectAltName::OID);
    if asked.info.subject.0.is_empty() && others.is_none() {
        return Err(KeysError("no-subject"));
    }
    issue(authority_key, &signer.tbs_certificate.subject, Some(signer.tbs_certificate.subject_public_key_info.subject_public_key.raw_bytes()), asked.info.subject.clone(), info, others, days, authority)
}

/// A PKCS #12 file (.pfx, .p12) holding the key and its certificates (its own first), locked with the password.
/// `compatible`: locked the older way (3DES and SHA-1), which every program opens; else AES-256 and SHA-256.
pub fn pkcs12(key: &Key, certificates: &[Vec<u8>], password: &str, name: &str, compatible: bool) -> Result<Vec<u8>> {
    use p12_keystore::{Certificate as Held, EncryptionAlgorithm, KeyStore, KeyStoreEntry, MacAlgorithm, PrivateKeyChain};
    let first = certificates.first().ok_or(KeysError("no-certificate"))?;
    if public_of_certificate(first)?.digest()? != key.public().digest()? {
        return Err(KeysError("key-mismatch"));
    }
    let chain = certificates.iter().map(|der| Held::from_der(der).map_err(unread)).collect::<Result<Vec<_>>>()?;
    let mut store = KeyStore::new();
    let id = Sha256::digest(first);
    store.add_entry(if name.trim().is_empty() { "1" } else { name.trim() }, KeyStoreEntry::PrivateKeyChain(PrivateKeyChain::new(key.pkcs8()?.as_bytes(), &id[..20], chain)));
    let writer = store.writer(password);
    let writer = if compatible { writer.encryption_algorithm(EncryptionAlgorithm::PbeWithShaAnd3KeyTripleDesCbc).mac_algorithm(MacAlgorithm::HmacSha1) } else { writer.encryption_algorithm(EncryptionAlgorithm::PbeWithHmacSha256AndAes256).mac_algorithm(MacAlgorithm::HmacSha256) };
    writer.write().map_err(failed)
}

/// The public key a certificate is for.
pub fn public_of_certificate(der: &[u8]) -> Result<Public> {
    let certificate = Certificate::from_der(der).map_err(unread)?;
    Public::from_spki(&certificate.tbs_certificate.subject_public_key_info.to_der().map_err(failed)?)
}

/// The public key a request is for.
pub fn public_of_request(der: &[u8]) -> Result<Public> {
    let request = CertReq::from_der(der).map_err(unread)?;
    Public::from_spki(&request.info.public_key.to_der().map_err(failed)?)
}

/// A key told to the interface: what it is, and itself in every form it is written in. `passphrase` locks the forms
/// that can be locked (PKCS #8 and OpenSSH); the older form cannot be, and is left out then.
pub fn told_key(key: &Key, comment: &str, passphrase: Option<&str>) -> Result<Value> {
    let passphrase = passphrase.filter(|passphrase| !passphrase.is_empty());
    let public = key.public();
    let (kind, bits) = public.kind();
    Ok(json!({
        "kind": kind,
        "bits": bits,
        "locked": passphrase.is_some(),
        "fingerprint": public.fingerprint()?,
        "digest": public.digest()?,
        "pkcs8": key.pkcs8_pem(passphrase)?,
        "traditional": if passphrase.is_some() { None } else { key.traditional_pem()? },
        "openssh": key.openssh_pem(comment, passphrase)?,
        "publicPem": public.pem()?,
        "publicOpenssh": public.openssh_line(comment)?,
    }))
}

pub fn told_public(public: &Public, comment: &str) -> Result<Value> {
    let (kind, bits) = public.kind();
    Ok(json!({ "kind": kind, "bits": bits, "fingerprint": public.fingerprint()?, "digest": public.digest()?, "publicPem": public.pem()?, "publicOpenssh": public.openssh_line(comment)? }))
}

fn unix(time: &Time) -> u64 {
    time.to_unix_duration().as_secs()
}

/// A certificate told to the interface: whom it is for, who signed it, how long it holds, its key, and itself as PEM.
pub fn told_certificate(der: &[u8]) -> Result<Value> {
    let certificate = Certificate::from_der(der).map_err(unread)?;
    let tbs = &certificate.tbs_certificate;
    let public = public_of_certificate(der).ok();
    Ok(json!({
        "subject": tbs.subject.to_string(),
        "issuer": tbs.issuer.to_string(),
        "selfSigned": tbs.subject == tbs.issuer,
        "notBefore": unix(&tbs.validity.not_before),
        "notAfter": unix(&tbs.validity.not_after),
        "serial": hex(tbs.serial_number.as_bytes()),
        "kind": public.as_ref().map(|public| public.kind().0),
        "bits": public.as_ref().map(|public| public.kind().1),
        "digest": public.as_ref().and_then(|public| public.digest().ok()),
        "sha256": hex(&Sha256::digest(der)),
        "pem": pem("CERTIFICATE", der),
    }))
}

pub fn told_request(der: &[u8]) -> Result<Value> {
    let request = CertReq::from_der(der).map_err(unread)?;
    let public = public_of_request(der).ok();
    Ok(json!({
        "subject": request.info.subject.to_string(),
        "kind": public.as_ref().map(|public| public.kind().0),
        "bits": public.as_ref().map(|public| public.kind().1),
        "digest": public.as_ref().and_then(|public| public.digest().ok()),
        "pem": pem("CERTIFICATE REQUEST", der),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn subject() -> Subject {
        Subject { common_name: "example.test".into(), organization: "Example Ltd".into(), country: "ro".into(), ..Subject::default() }
    }

    fn kinds() -> [Kind; 5] {
        [Kind::Rsa(2048), Kind::P256, Kind::P384, Kind::P521, Kind::Ed25519]
    }

    #[test]
    fn an_ed25519_key_is_written_as_pkcs8_that_openssl_3_0_reads() {
        let key = Key::make(Kind::Ed25519).expect("made");
        let der = key.pkcs8().expect("written");
        let info = pkcs8::PrivateKeyInfo::try_from(der.as_bytes()).expect("PKCS #8");
        // Version 1: no public key beside the private one.
        assert!(info.public_key.is_none());
        let back = read(key.pkcs8_pem(None).expect("written").as_bytes(), None).expect("read").key.expect("a key");
        assert_eq!(back.public().digest().expect("told"), key.public().digest().expect("told"));
    }

    #[test]
    fn writes_a_key_in_every_form_and_reads_each_back() {
        for kind in kinds() {
            let key = Key::make(kind).expect("made");
            let digest = key.public().digest().expect("digest");
            let same = |text: &str, passphrase: Option<&str>| read(text.as_bytes(), passphrase).unwrap_or_else(|error| panic!("{kind:?} {error:?} {}", text.lines().next().unwrap_or_default())).key.expect("a key").public().digest().expect("digest") == digest;
            assert!(same(&key.pkcs8_pem(None).expect("written"), None), "{kind:?} PKCS #8");
            assert!(same(&key.openssh_pem("me@here", None).expect("written"), None), "{kind:?} OpenSSH");
            if let Some(traditional) = key.traditional_pem().expect("written") {
                assert!(same(&traditional, None), "{kind:?} traditional");
            }
            // Bytes in DER, with nothing to say what they are.
            assert!(read(key.pkcs8().expect("written").as_bytes(), None).expect("read").key.is_some(), "{kind:?} DER");
            // The public half, by itself, as PEM and as the line of OpenSSH.
            let public = key.public();
            let line = public.openssh_line("me@here").expect("written");
            for text in [public.pem().expect("written"), line.clone()] {
                assert_eq!(read(text.as_bytes(), None).expect("read").public.expect("a public key").digest().expect("digest"), digest, "{kind:?} public");
            }
            assert!(line.ends_with(" me@here"));
            assert!(public.fingerprint().expect("told").starts_with("SHA256:"));
        }
    }

    #[test]
    fn locks_a_key_with_a_passphrase_and_opens_it_only_with_it() {
        // Locking is made slow on purpose: one kind is enough to see it done.
        let key = Key::make(Kind::Ed25519).expect("made");
        for locked in [key.pkcs8_pem(Some("open sesame")).expect("locked"), key.openssh_pem("", Some("open sesame")).expect("locked")] {
            assert!(!locked.contains("-----BEGIN PRIVATE KEY-----"));
            assert_eq!(read(locked.as_bytes(), None).err(), Some(KeysError("needs-passphrase")));
            assert_eq!(read(locked.as_bytes(), Some("wrong")).err(), Some(KeysError("bad-passphrase")));
            let opened = read(locked.as_bytes(), Some("open sesame")).expect("opened");
            assert!(opened.locked && opened.key.is_some());
        }
    }

    #[test]
    fn makes_a_request_and_a_certificate_for_each_kind_of_key() {
        let names = vec!["example.test".to_owned(), "*.example.test".to_owned(), "10.0.0.1".to_owned(), "::1".to_owned(), "admin@example.test".to_owned()];
        for kind in kinds() {
            let key = Key::make(kind).expect("made");
            let digest = key.public().digest().expect("digest");
            let asked = request(&key, &subject(), &names).expect("a request");
            assert_eq!(public_of_request(&asked).expect("read").digest().expect("digest"), digest, "{kind:?}");
            let told = told_request(&asked).expect("told");
            assert_eq!(told["subject"], "CN=example.test,O=Example Ltd,C=RO");

            let signed = self_signed(&key, &subject(), &names, 365, false).expect("a certificate");
            let told = told_certificate(&signed).expect("told");
            assert_eq!((told["selfSigned"].clone(), told["digest"].clone()), (json!(true), json!(digest)), "{kind:?}");
            let lasts = told["notAfter"].as_u64().expect("a time") - told["notBefore"].as_u64().expect("a time");
            assert_eq!(lasts, 365 * 86_400 + 300);
            // The reader of certificates the suite already has reads it, with its names.
            let (_, parsed) = x509_parser::parse_x509_certificate(&signed).expect("parsed");
            let other = parsed.subject_alternative_name().expect("read").expect("names");
            assert_eq!(other.value.general_names.len(), 5, "{kind:?}");
            assert!(!parsed.is_ca());
        }
        let root = self_signed(&Key::make(Kind::P256).expect("made"), &subject(), &[], 3650, true).expect("a certificate");
        assert!(x509_parser::parse_x509_certificate(&root).expect("parsed").1.is_ca());
    }

    #[test]
    fn signs_a_request_with_an_authority_of_its_own() {
        let names = vec!["server.test".to_owned(), "10.0.0.2".to_owned()];
        for (root_kind, kind) in [(Kind::P256, Kind::Rsa(2048)), (Kind::Rsa(2048), Kind::Ed25519), (Kind::Ed25519, Kind::P384), (Kind::P384, Kind::P521), (Kind::P521, Kind::P256)] {
            let root_key = Key::make(root_kind).expect("made");
            let root = self_signed(&root_key, &Subject { common_name: "Test Root".into(), ..Subject::default() }, &[], 3650, true).expect("a root");
            let key = Key::make(kind).expect("made");
            let asked = request(&key, &subject(), &names).expect("a request");
            let signed = sign_request(&root_key, &root, &asked, 90, false).expect("signed");
            let told = told_certificate(&signed).expect("told");
            assert_eq!((told["subject"].clone(), told["issuer"].clone(), told["selfSigned"].clone()), (json!("CN=example.test,O=Example Ltd,C=RO"), json!("CN=Test Root"), json!(false)), "{kind:?}");
            assert_eq!(told["digest"], json!(key.public().digest().expect("digest")));
            // Signed by the key of the root: checked the way the request's own signature is.
            let certificate = Certificate::from_der(&signed).expect("read");
            root_key.public().verify(&certificate.signature_algorithm.oid, &certificate.tbs_certificate.to_der().expect("written"), certificate.signature.raw_bytes()).unwrap_or_else(|error| panic!("{root_kind:?}: {error:?}"));
            // The names the request asked for are in it, and it names the key that signed it.
            let (_, parsed) = x509_parser::parse_x509_certificate(&signed).expect("parsed");
            assert_eq!(parsed.subject_alternative_name().expect("read").expect("names").value.general_names.len(), 2);
            assert!(parsed.extensions().iter().any(|extension| extension.oid == x509_parser::oid_registry::OID_X509_EXT_AUTHORITY_KEY_IDENTIFIER));

            // Not with a key that is not the authority's, not with a certificate that may not sign, not a request that was changed.
            assert_eq!(sign_request(&key, &root, &asked, 90, false).err(), Some(KeysError("key-mismatch")));
            assert_eq!(sign_request(&key, &signed, &asked, 90, false).err(), Some(KeysError("not-authority")));
            let mut changed = asked.clone();
            let at = changed.windows(12).position(|window| window == b"example.test").expect("the name");
            changed[at] = b'E';
            assert_eq!(sign_request(&root_key, &root, &changed, 90, false).err(), Some(KeysError("bad-signature")), "{kind:?}");
        }
    }

    #[test]
    fn refuses_a_subject_that_says_nothing_or_is_wrong() {
        let key = Key::make(Kind::Ed25519).expect("made");
        assert_eq!(request(&key, &Subject::default(), &[]).err(), Some(KeysError("no-subject")));
        assert_eq!(request(&key, &Subject { country: "Romania".into(), ..subject() }, &[]).err(), Some(KeysError("bad-country")));
        assert_eq!(request(&key, &subject(), &["not a name".to_owned()]).err(), Some(KeysError("bad-name")));
        // Names alone are enough: a certificate need not have a subject.
        assert!(request(&key, &Subject::default(), &["example.test".to_owned()]).is_ok());
        assert_eq!(Key::make(Kind::Rsa(512)).err(), Some(KeysError("rsa-too-small")));
    }

    #[test]
    fn puts_a_key_and_its_certificate_in_a_pkcs12_file_and_reads_them_back() {
        let key = Key::make(Kind::P256).expect("made");
        let certificate = self_signed(&key, &subject(), &[], 30, false).expect("a certificate");
        for compatible in [false, true] {
            let file = pkcs12(&key, std::slice::from_ref(&certificate), "secret", "example", compatible).expect("written");
            assert!(is_pkcs12(&file));
            assert_eq!(read(&file, None).err(), Some(KeysError("needs-passphrase")));
            assert_eq!(read(&file, Some("wrong")).err(), Some(KeysError("bad-passphrase")));
            let found = read(&file, Some("secret")).expect("read");
            assert_eq!(found.form, "pkcs12");
            assert_eq!(found.certificates, vec![certificate.clone()]);
            assert_eq!(found.key.expect("a key").public().digest().expect("digest"), key.public().digest().expect("digest"));
        }
        // A key that is not the certificate's is not put with it.
        let other = Key::make(Kind::P256).expect("made");
        assert_eq!(pkcs12(&other, &[certificate], "secret", "", false).err(), Some(KeysError("key-mismatch")));
        assert_eq!(pkcs12(&key, &[], "secret", "", false).err(), Some(KeysError("no-certificate")));
    }

    #[test]
    fn reads_several_things_from_one_text_and_refuses_what_is_none() {
        let key = Key::make(Kind::Ed25519).expect("made");
        let certificate = self_signed(&key, &subject(), &[], 30, false).expect("a certificate");
        let text = format!("{}\nsome words between\n{}", pem("CERTIFICATE", &certificate), key.pkcs8_pem(None).expect("written"));
        let found = read(text.as_bytes(), None).expect("read");
        assert_eq!((found.form, found.certificates.len(), found.key.is_some()), ("pem", 1, true));
        assert_eq!(read(&certificate, None).expect("read").certificates.len(), 1);
        assert_eq!(read(b"hello", None).err(), Some(KeysError("not-recognized")));
        assert_eq!(read(b"-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n", None).err(), Some(KeysError("not-recognized")));
        // Locked the way OpenSSL once did, with a cipher that is not opened here.
        let old = "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: CAMELLIA-256-CBC,00112233445566778899AABBCCDDEEFF\n\nAAAA\n-----END RSA PRIVATE KEY-----\n";
        assert_eq!(read(old.as_bytes(), Some("x")).err(), Some(KeysError("old-lock")));
        assert_eq!(read(old.as_bytes(), None).err(), Some(KeysError("needs-passphrase")));
    }
}

/// Written for the standard tools to read (`openssl`, `ssh-keygen`): run by hand, with `DEV_KEYS_OUT` naming a folder.
#[cfg(test)]
mod for_other_tools {
    use super::*;

    #[test]
    #[ignore]
    fn writes_keys_and_certificates_for_the_standard_tools() {
        let folder = std::path::PathBuf::from(std::env::var("DEV_KEYS_OUT").expect("DEV_KEYS_OUT names a folder"));
        let subject = Subject { common_name: "example.test".into(), organization: "Example Ltd".into(), country: "RO".into(), email: "admin@example.test".into(), ..Subject::default() };
        let names = vec!["example.test".to_owned(), "*.example.test".to_owned(), "10.0.0.1".to_owned()];
        for (name, kind) in [("rsa", Kind::Rsa(2048)), ("p256", Kind::P256), ("p384", Kind::P384), ("p521", Kind::P521), ("ed25519", Kind::Ed25519)] {
            let key = Key::make(kind).expect("made");
            let write = |ending: &str, bytes: &[u8]| std::fs::write(folder.join(format!("{name}.{ending}")), bytes).expect("written");
            write("pkcs8.pem", key.pkcs8_pem(None).expect("written").as_bytes());
            write("locked.pem", key.pkcs8_pem(Some("secret")).expect("written").as_bytes());
            if let Some(traditional) = key.traditional_pem().expect("written") {
                write("traditional.pem", traditional.as_bytes());
            }
            write("openssh", key.openssh_pem("me@here", None).expect("written").as_bytes());
            write("openssh-locked", key.openssh_pem("me@here", Some("secret")).expect("written").as_bytes());
            write("pub.pem", key.public().pem().expect("written").as_bytes());
            write("pub", format!("{}\n", key.public().openssh_line("me@here").expect("written")).as_bytes());
            write("fingerprint", key.public().fingerprint().expect("told").as_bytes());
            write("csr.pem", pem("CERTIFICATE REQUEST", &request(&key, &subject, &names).expect("a request")).as_bytes());
            let certificate = self_signed(&key, &subject, &names, 365, false).expect("a certificate");
            write("crt.pem", pem("CERTIFICATE", &certificate).as_bytes());
            write("crt.der", &certificate);
            let root_key = Key::make(kind).expect("made");
            let root = self_signed(&root_key, &Subject { common_name: "Test Root".into(), ..Subject::default() }, &[], 3650, true).expect("a root");
            write("root.pem", pem("CERTIFICATE", &root).as_bytes());
            write("signed.pem", pem("CERTIFICATE", &sign_request(&root_key, &root, &request(&key, &subject, &names).expect("a request"), 90, false).expect("signed")).as_bytes());
            write("pfx", &pkcs12(&key, std::slice::from_ref(&certificate), "secret", "example", false).expect("written"));
            write("compatible.pfx", &pkcs12(&key, &[certificate], "secret", "example", true).expect("written"));
        }
    }
}

/// Reads what the standard tools wrote: run by hand, with `DEV_KEYS_IN` naming a folder of their files.
#[cfg(test)]
mod from_other_tools {
    use super::*;

    #[test]
    #[ignore]
    fn reads_what_the_standard_tools_wrote() {
        let folder = std::path::PathBuf::from(std::env::var("DEV_KEYS_IN").expect("DEV_KEYS_IN names a folder"));
        let mut names: Vec<_> = std::fs::read_dir(&folder).expect("a folder").map(|entry| entry.expect("an entry").path()).collect();
        names.sort();
        for path in names {
            let given = std::fs::read(&path).expect("read");
            let told = |found: Result<Found>| match found {
                Ok(found) => format!("{} key={} public={} certificates={} requests={} locked={} comment={:?}", found.form, found.key.as_ref().map(|key| key.public().kind().0).unwrap_or("-"), found.public.as_ref().map(|key| key.kind().0).unwrap_or("-"), found.certificates.len(), found.requests.len(), found.locked, found.comment),
                Err(error) => format!("{error:?}"),
            };
            println!("{:<22} {} | with passphrase: {}", path.file_name().unwrap_or_default().to_string_lossy(), told(read(&given, None)), told(read(&given, Some("secret"))));
        }
    }
}
