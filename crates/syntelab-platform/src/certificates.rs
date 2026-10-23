//! Certificates for signing documents, and the signatures made with them.
//!
//! On Windows the certificates are those of the user's own store (which also
//! shows the ones on a smart card or a token: Windows then asks for the PIN
//! itself), or the one in a `.pfx`/`.p12` file. A signature is a detached CMS
//! message (PKCS #7) over the bytes handed in, made with SHA-256 and carrying
//! the signing certificate as PAdES asks (`signing-certificate-v2`).
//!
//! Nothing here goes online on its own: certificates are checked against what
//! the computer already trusts (PDF Organizer asks the issuer itself, through
//! `syntelab-net`, when a signature gets a time stamp, and hands the answer in
//! as a signed attribute). The time stamps a signature or a document carries
//! (RFC 3161) are checked the same way: the authority's signature over them,
//! and the chain of its certificate as far as the computer knows it. The one
//! exception is [`check_revocation`], which the user asks for with a button:
//! Windows then asks the issuers named in the certificates themselves (see
//! `docs/decisions/0004-zero-telemetry.md`).

use std::fmt;

/// A certificate that can sign.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Certificate {
    /// Tells it apart from the others of the store (its SHA-1 fingerprint, in hexadecimal).
    pub id: String,
    /// Who it belongs to.
    pub subject: String,
    /// Who issued it.
    pub issuer: String,
    /// From when and until when it is valid, in seconds since 1970 (UTC).
    pub valid_from: i64,
    pub valid_until: i64,
}

/// Where the certificate to sign with is.
#[derive(Debug, Clone, Copy)]
pub enum Source<'a> {
    /// In the user's store, by its [`Certificate::id`].
    Store { id: &'a str },
    /// In a `.pfx`/`.p12` file (its content), opened with its password. The key is used from memory and kept nowhere.
    File { data: &'a [u8], password: &'a str },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CertificateError {
    /// This system has no certificates this program can use yet.
    Unsupported,
    /// No such certificate, or none in the file that can sign.
    NotFound,
    /// The file could not be opened with this password.
    WrongPassword,
    /// The user closed the window that asked for the PIN.
    Cancelled,
    Failed(String),
}

impl fmt::Display for CertificateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => write!(formatter, "certificates are not supported on this system"),
            Self::NotFound => write!(formatter, "no certificate that can sign was found"),
            Self::WrongPassword => write!(formatter, "the password does not open the file"),
            Self::Cancelled => write!(formatter, "signing was cancelled"),
            Self::Failed(reason) => write!(formatter, "{reason}"),
        }
    }
}

impl std::error::Error for CertificateError {}

/// How far the computer trusts the certificate a signature was made with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trust {
    /// It leads to an authority the computer trusts, and it is valid today.
    Trusted,
    /// It leads to a trusted authority, but its time is over (or not yet come).
    Expired,
    /// The computer does not know who stands behind it (a certificate one makes for oneself, an unknown authority).
    Untrusted,
}

/// What looking at a signature says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verified {
    /// The signature fits the bytes: they are as they were when it was made.
    pub intact: bool,
    /// Who signed, and who issued their certificate; empty when the signature does not say.
    pub signer: String,
    pub issuer: String,
    pub trust: Trust,
}

/// What looking at a time stamp says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedTimeStamp {
    /// The authority's signature over the stamp is good, and the stamp is of the bytes it should be of.
    pub intact: bool,
    /// The authority that made it; empty when the stamp does not say.
    pub authority: String,
    pub trust: Trust,
}

/// What the issuers of a certificate say of it now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Revocation {
    /// None of the certificates of its chain was revoked.
    Good,
    /// It, or one that issued it, was revoked: it can no longer be relied on.
    Revoked,
    /// An issuer could not be asked, or did not answer.
    Unknown,
}

/// The certificates of the user that have their key at hand, so they can sign.
pub fn signing_certificates() -> Vec<Certificate> {
    imp::signing_certificates()
}

/// The certificate a source would sign with: to show who that is, and to try a password.
pub fn certificate_of(source: Source<'_>) -> Result<Certificate, CertificateError> {
    imp::certificate_of(source)
}

/// Signs `parts` (taken as one run of bytes) and returns the signature: a detached CMS message.
pub fn sign_detached(source: Source<'_>, parts: &[&[u8]]) -> Result<Vec<u8>, CertificateError> {
    imp::sign_detached(source, parts, &[])
}

/// As [`sign_detached`], with more signed attributes: each its object identifier (`"1.2.840.113583.1.1.8"`) and its
/// one value, DER-encoded.
pub fn sign_detached_with(source: Source<'_>, parts: &[&[u8]], attributes: &[(&str, &[u8])]) -> Result<Vec<u8>, CertificateError> {
    imp::sign_detached(source, parts, attributes)
}

/// The certificates from the one of `source` up towards an authority the computer trusts, each DER-encoded, the
/// source's own first: as far as the computer can follow them without going online.
pub fn chain_of(source: Source<'_>) -> Result<Vec<Vec<u8>>, CertificateError> {
    imp::chain_of(source)
}

/// Looks at a detached CMS `signature` over `parts`. `Err` when it is no signature at all.
pub fn verify_detached(signature: &[u8], parts: &[&[u8]]) -> Result<Verified, CertificateError> {
    imp::verify_detached(signature, parts)
}

/// Looks at a time stamp (`token`, a `TimeStampToken`) that should be of `parts` (taken as one run of bytes): of a
/// signature's value, for the stamp a signature carries, or of what a document's own stamp covers. `Err` when it is
/// no time stamp at all.
pub fn verify_time_stamp(token: &[u8], parts: &[&[u8]]) -> Result<VerifiedTimeStamp, CertificateError> {
    imp::verify_time_stamp(token, parts)
}

/// Shows the system's own window for a certificate: `certificates[0]`, with the others (those that issued it, as a
/// signature carries them) to follow its chain. From there the user can see every detail, and add a certificate to
/// those the computer trusts. Blocks until the window is closed.
pub fn show_certificate(certificates: &[Vec<u8>]) -> Result<(), CertificateError> {
    imp::show_certificate(certificates)
}

/// Asks online whether `certificates[0]`, or one that issued it, was revoked: the others are those that issued it, as
/// a signature carries them. Goes online only because the user asked; blocks until every issuer answered or gave up.
pub fn check_revocation(certificates: &[Vec<u8>]) -> Result<Revocation, CertificateError> {
    imp::check_revocation(certificates)
}

/// The `signing-certificate-v2` attribute for a certificate with this SHA-256
/// fingerprint: the signature says which certificate it was made with, so
/// another one with the same key cannot be put in its place.
#[cfg_attr(not(windows), allow(dead_code))]
fn signing_certificate_v2(fingerprint: &[u8; 32]) -> Vec<u8> {
    // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }, with
    // ESSCertIDv2 ::= SEQUENCE { certHash OCTET STRING } (SHA-256 is the default algorithm and is left out).
    let mut encoded = vec![0x30, 0x26, 0x30, 0x24, 0x30, 0x22, 0x04, 0x20];
    encoded.extend_from_slice(fingerprint);
    encoded
}

#[cfg(not(windows))]
mod imp {
    use super::{Certificate, CertificateError, Revocation, Source, Verified, VerifiedTimeStamp};

    pub fn signing_certificates() -> Vec<Certificate> {
        Vec::new()
    }

    pub fn certificate_of(_source: Source<'_>) -> Result<Certificate, CertificateError> {
        Err(CertificateError::Unsupported)
    }

    pub fn sign_detached(_source: Source<'_>, _parts: &[&[u8]], _attributes: &[(&str, &[u8])]) -> Result<Vec<u8>, CertificateError> {
        Err(CertificateError::Unsupported)
    }

    pub fn chain_of(_source: Source<'_>) -> Result<Vec<Vec<u8>>, CertificateError> {
        Err(CertificateError::Unsupported)
    }

    pub fn verify_detached(_signature: &[u8], _parts: &[&[u8]]) -> Result<Verified, CertificateError> {
        Err(CertificateError::Unsupported)
    }

    pub fn verify_time_stamp(_token: &[u8], _parts: &[&[u8]]) -> Result<VerifiedTimeStamp, CertificateError> {
        Err(CertificateError::Unsupported)
    }

    pub fn show_certificate(_certificates: &[Vec<u8>]) -> Result<(), CertificateError> {
        Err(CertificateError::Unsupported)
    }

    pub fn check_revocation(_certificates: &[Vec<u8>]) -> Result<Revocation, CertificateError> {
        Err(CertificateError::Unsupported)
    }
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::ptr;

    use windows::core::{w, HSTRING, PSTR};
    use windows::Win32::Security::Cryptography::{
        CertCloseStore, CertEnumCertificatesInStore, CertFreeCertificateChain, CertFreeCertificateContext, CertGetCertificateChain,
        CertGetCertificateContextProperty, CertGetNameStringW, CertOpenSystemStoreW, CryptGetMessageCertificates, CryptMemFree, CryptSignMessage,
        CryptVerifyDetachedMessageSignature, CryptVerifyTimeStampSignature, PFXImportCertStore, CRYPT_TIMESTAMP_CONTEXT, CERT_CHAIN_CACHE_ONLY_URL_RETRIEVAL, CERT_CHAIN_CONTEXT, CERT_CHAIN_PARA,
        CERT_CONTEXT, CERT_KEY_CONTEXT_PROP_ID, CERT_KEY_PROV_INFO_PROP_ID, CERT_NAME_ISSUER_FLAG, CERT_NAME_SIMPLE_DISPLAY_TYPE,
        CERT_NCRYPT_KEY_HANDLE_PROP_ID, CERT_SHA1_HASH_PROP_ID, CERT_SHA256_HASH_PROP_ID, CERT_TRUST_IS_NOT_TIME_NESTED,
        CERT_TRUST_IS_NOT_TIME_VALID, CRYPT_ATTRIBUTE, CRYPT_INTEGER_BLOB, CRYPT_SIGN_MESSAGE_PARA, CRYPT_VERIFY_MESSAGE_PARA, HCERTSTORE,
        PKCS12_NO_PERSIST_KEY, PKCS12_PREFER_CNG_KSP, PKCS_7_ASN_ENCODING, X509_ASN_ENCODING,
    };

    use windows::Win32::Security::Cryptography::UI::{
        CryptUIDlgViewCertificateW, CRYPTUI_CACHE_ONLY_URL_RETRIEVAL, CRYPTUI_DISABLE_EDITPROPERTIES, CRYPTUI_VIEWCERTIFICATE_FLAGS, CRYPTUI_VIEWCERTIFICATE_STRUCTW,
    };
    use windows::Win32::Security::Cryptography::{
        CertAddEncodedCertificateToStore, CertOpenStore, CERT_CHAIN_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT, CERT_OPEN_STORE_FLAGS, CERT_QUERY_ENCODING_TYPE,
        CERT_STORE_ADD_ALWAYS, CERT_STORE_PROV_MEMORY, CERT_TRUST_IS_OFFLINE_REVOCATION, CERT_TRUST_IS_PARTIAL_CHAIN, CERT_TRUST_IS_REVOKED,
        CERT_TRUST_REVOCATION_STATUS_UNKNOWN,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    use super::{signing_certificate_v2, Certificate, CertificateError, Revocation, Source, Trust, Verified, VerifiedTimeStamp};

    /// How long one issuer is waited for, in milliseconds.
    const ISSUER_TIME_LIMIT: u32 = 15_000;

    const ENCODING: u32 = X509_ASN_ENCODING.0 | PKCS_7_ASN_ENCODING.0;
    /// SHA-256, and the attribute that names the signing certificate, as their object identifiers.
    const SHA256: &[u8] = b"2.16.840.1.101.3.4.2.1\0";
    const SIGNING_CERTIFICATE_V2: &[u8] = b"1.2.840.113549.1.9.16.2.47\0";
    /// What Windows answers when a password does not open a file, and when the user turns a PIN window away.
    const WRONG_PASSWORD: i32 = 0x8007_0056_u32 as i32;
    const CANCELLED: [i32; 3] = [0x8007_04C7_u32 as i32, 0x8010_006E_u32 as i32, 0x8009_0036_u32 as i32];

    /// A store of certificates, closed when it is let go.
    struct Store(HCERTSTORE);

    impl Drop for Store {
        fn drop(&mut self) {
            // SAFETY: the handle came from a function that opens a store and is closed once.
            let _ = unsafe { CertCloseStore(Some(self.0), 0) };
        }
    }

    impl Store {
        fn of_the_user() -> Result<Self, CertificateError> {
            // SAFETY: a plain call; "MY" is the user's own certificates.
            unsafe { CertOpenSystemStoreW(None, w!("MY")) }.map(Self).map_err(failed)
        }

        fn of_file(data: &[u8], password: &str) -> Result<Self, CertificateError> {
            let blob = CRYPT_INTEGER_BLOB { cbData: length(data.len())?, pbData: data.as_ptr().cast_mut() };
            // The key stays in memory: nothing of the file is kept on the computer.
            // SAFETY: the blob points at `data`, which outlives the call; the password is a valid wide string.
            unsafe { PFXImportCertStore(&blob, &HSTRING::from(password), PKCS12_NO_PERSIST_KEY | PKCS12_PREFER_CNG_KSP) }.map(Self).map_err(|error| {
                if error.code().0 == WRONG_PASSWORD {
                    CertificateError::WrongPassword
                } else {
                    failed(error)
                }
            })
        }

        /// Every certificate of the store, in turn, for as long as `each` answers true. The pointer is only good
        /// inside `each`, except the one it answered false for: that one is then the caller's to free.
        fn each(&self, mut each: impl FnMut(*const CERT_CONTEXT) -> bool) {
            let mut current: *mut CERT_CONTEXT = ptr::null_mut();
            loop {
                // SAFETY: the store is open; the previous context is handed back, which frees it.
                current = unsafe { CertEnumCertificatesInStore(self.0, (!current.is_null()).then_some(current.cast_const())) };
                if current.is_null() {
                    return;
                }
                if !each(current) {
                    return;
                }
            }
        }
    }

    fn failed(error: windows::core::Error) -> CertificateError {
        if CANCELLED.contains(&error.code().0) {
            CertificateError::Cancelled
        } else {
            CertificateError::Failed(error.message())
        }
    }

    fn length(length: usize) -> Result<u32, CertificateError> {
        u32::try_from(length).map_err(|_| CertificateError::Failed("too large to sign".into()))
    }

    /// A property of a certificate, as bytes; `None` when it has none.
    fn property(certificate: *const CERT_CONTEXT, id: u32) -> Option<Vec<u8>> {
        let mut size = 0_u32;
        // SAFETY: asks for the size only.
        unsafe { CertGetCertificateContextProperty(certificate, id, None, &mut size) }.ok()?;
        let mut data = vec![0_u8; size as usize];
        // SAFETY: the buffer is as large as the size just answered.
        unsafe { CertGetCertificateContextProperty(certificate, id, Some(data.as_mut_ptr().cast::<c_void>()), &mut size) }.ok()?;
        data.truncate(size as usize);
        Some(data)
    }

    fn has_key(certificate: *const CERT_CONTEXT) -> bool {
        [CERT_KEY_PROV_INFO_PROP_ID, CERT_NCRYPT_KEY_HANDLE_PROP_ID, CERT_KEY_CONTEXT_PROP_ID].iter().any(|id| {
            let mut size = 0_u32;
            // SAFETY: asks for the size only.
            unsafe { CertGetCertificateContextProperty(certificate, *id, None, &mut size) }.is_ok()
        })
    }

    fn name(certificate: *const CERT_CONTEXT, flags: u32) -> String {
        let mut text = [0_u16; 512];
        // SAFETY: the buffer and its length are passed together.
        let written = unsafe { CertGetNameStringW(certificate, CERT_NAME_SIMPLE_DISPLAY_TYPE, flags, None, Some(&mut text)) } as usize;
        String::from_utf16_lossy(&text[..written.saturating_sub(1).min(text.len())])
    }

    fn describe(certificate: *const CERT_CONTEXT) -> Certificate {
        /// A Windows time (100 ns since 1601) as seconds since 1970.
        fn seconds(time: windows::Win32::Foundation::FILETIME) -> i64 {
            let ticks = (i64::from(time.dwHighDateTime) << 32) | i64::from(time.dwLowDateTime);
            ticks / 10_000_000 - 11_644_473_600
        }
        // SAFETY: a live context always carries its decoded facts.
        let facts = unsafe { &*(*certificate).pCertInfo };
        let id = property(certificate, CERT_SHA1_HASH_PROP_ID).unwrap_or_default().iter().map(|byte| format!("{byte:02X}")).collect();
        Certificate {
            id,
            subject: name(certificate, 0),
            issuer: name(certificate, CERT_NAME_ISSUER_FLAG),
            valid_from: seconds(facts.NotBefore),
            valid_until: seconds(facts.NotAfter),
        }
    }

    /// Finds the certificate of `source` and hands it to `with`, with the store it lives in kept open meanwhile.
    fn with_signer<T>(source: Source<'_>, with: impl FnOnce(*const CERT_CONTEXT) -> Result<T, CertificateError>) -> Result<T, CertificateError> {
        let store = match source {
            Source::Store { .. } => Store::of_the_user()?,
            Source::File { data, password } => Store::of_file(data, password)?,
        };
        let mut found: *const CERT_CONTEXT = ptr::null();
        store.each(|certificate| {
            let wanted = match source {
                Source::Store { id } => describe(certificate).id.eq_ignore_ascii_case(id),
                Source::File { .. } => true,
            };
            if wanted && has_key(certificate) {
                found = certificate;
                return false;
            }
            true
        });
        if found.is_null() {
            return Err(CertificateError::NotFound);
        }
        let answer = with(found);
        // SAFETY: the enumeration stopped on `found`, which left it ours to free, once.
        let _ = unsafe { CertFreeCertificateContext(Some(found)) };
        answer
    }

    pub fn signing_certificates() -> Vec<Certificate> {
        let Ok(store) = Store::of_the_user() else {
            return Vec::new();
        };
        let mut certificates = Vec::new();
        store.each(|certificate| {
            if has_key(certificate) {
                certificates.push(describe(certificate));
            }
            true
        });
        certificates
    }

    pub fn certificate_of(source: Source<'_>) -> Result<Certificate, CertificateError> {
        with_signer(source, |certificate| Ok(describe(certificate)))
    }

    /// The chain of a certificate, as far as the computer can build it without going online; freed when let go.
    struct Chain(*mut CERT_CHAIN_CONTEXT);

    impl Drop for Chain {
        fn drop(&mut self) {
            // SAFETY: the chain came from CertGetCertificateChain and is freed once.
            unsafe { CertFreeCertificateChain(self.0) };
        }
    }

    impl Chain {
        fn of(certificate: *const CERT_CONTEXT, also_from: Option<HCERTSTORE>) -> Option<Self> {
            let parameters = CERT_CHAIN_PARA { cbSize: size_of::<CERT_CHAIN_PARA>() as u32, ..Default::default() };
            let mut chain: *mut CERT_CHAIN_CONTEXT = ptr::null_mut();
            // Never online: what is missing is looked for in what the computer already has.
            // SAFETY: every pointer is valid for the call; the chain is freed by `Drop`.
            unsafe { CertGetCertificateChain(None, certificate, None, also_from, &parameters, CERT_CHAIN_CACHE_ONLY_URL_RETRIEVAL, None, &mut chain) }.ok()?;
            (!chain.is_null()).then_some(Self(chain))
        }

        /// The certificates of the chain, the signer's first.
        fn certificates(&self) -> Vec<*mut CERT_CONTEXT> {
            // SAFETY: a chain context holds `cChain` simple chains, each with `cElement` elements.
            unsafe {
                let chain = &*self.0;
                if chain.cChain == 0 || chain.rgpChain.is_null() {
                    return Vec::new();
                }
                let first = &**chain.rgpChain;
                (0..first.cElement as usize).map(|index| (**first.rgpElement.add(index)).pCertContext.cast_mut()).collect()
            }
        }

        fn trust(&self) -> Trust {
            // SAFETY: the chain is live.
            let errors = unsafe { (*self.0).TrustStatus.dwErrorStatus };
            let time_only = CERT_TRUST_IS_NOT_TIME_VALID | CERT_TRUST_IS_NOT_TIME_NESTED;
            if errors == 0 {
                Trust::Trusted
            } else if errors & !time_only == 0 {
                Trust::Expired
            } else {
                Trust::Untrusted
            }
        }
    }

    /// The bytes of a certificate, as it is encoded (DER).
    fn encoded(certificate: *const CERT_CONTEXT) -> Vec<u8> {
        // SAFETY: a live context holds its encoded form, of the length it says.
        unsafe { std::slice::from_raw_parts((*certificate).pbCertEncoded, (*certificate).cbCertEncoded as usize) }.to_vec()
    }

    /// Certificates handed in, in a store of their own in memory; `first` is the first of them, freed before the store.
    struct Carried {
        first: *mut CERT_CONTEXT,
        store: Store,
    }

    impl Drop for Carried {
        fn drop(&mut self) {
            // SAFETY: the context came from adding it to the store, and is freed once; the store is closed after.
            let _ = unsafe { CertFreeCertificateContext(Some(self.first)) };
        }
    }

    impl Carried {
        fn of(certificates: &[Vec<u8>]) -> Result<Self, CertificateError> {
            // SAFETY: a plain call; a store in memory needs nothing more.
            let store = unsafe { CertOpenStore(CERT_STORE_PROV_MEMORY, CERT_QUERY_ENCODING_TYPE(0), None, CERT_OPEN_STORE_FLAGS(0), None) }.map(Store).map_err(failed)?;
            let mut first: *mut CERT_CONTEXT = ptr::null_mut();
            for (index, certificate) in certificates.iter().enumerate() {
                let wanted = (index == 0).then_some(&mut first as *mut *mut CERT_CONTEXT);
                // SAFETY: the slice is passed with its length; the first one's context is kept and freed by `Drop`.
                let added = unsafe { CertAddEncodedCertificateToStore(Some(store.0), X509_ASN_ENCODING, certificate, CERT_STORE_ADD_ALWAYS, wanted) };
                // One of the others that cannot be read only leaves the chain shorter.
                if index == 0 {
                    added.map_err(|_| CertificateError::NotFound)?;
                }
            }
            if first.is_null() {
                return Err(CertificateError::NotFound);
            }
            Ok(Self { first, store })
        }
    }

    pub fn show_certificate(certificates: &[Vec<u8>]) -> Result<(), CertificateError> {
        let certificates = certificates.to_vec();
        // The window runs on a thread of its own, which waits on nothing else while it is open.
        let shown = std::thread::spawn(move || {
            let carried = Carried::of(&certificates)?;
            let mut stores = [carried.store.0];
            let flags = CRYPTUI_CACHE_ONLY_URL_RETRIEVAL.0 | CRYPTUI_DISABLE_EDITPROPERTIES.0;
            let window = CRYPTUI_VIEWCERTIFICATE_STRUCTW {
                dwSize: size_of::<CRYPTUI_VIEWCERTIFICATE_STRUCTW>() as u32,
                // The program's window, which the user just clicked in: the certificate's window stays in front of it.
                // SAFETY: a plain call.
                hwndParent: unsafe { GetForegroundWindow() },
                // Never online: the chain is followed through what the signature carries and the computer has.
                dwFlags: CRYPTUI_VIEWCERTIFICATE_FLAGS(flags),
                pCertContext: carried.first,
                cStores: 1,
                rghStores: stores.as_mut_ptr(),
                ..Default::default()
            };
            let mut changed = windows::core::BOOL(0);
            // SAFETY: every pointer of the structure is valid until the window is closed.
            match unsafe { CryptUIDlgViewCertificateW(&window, &mut changed) } {
                Ok(()) => Ok(()),
                // Closed by the user: nothing went wrong.
                Err(error) if error.code().0 == 0 || CANCELLED.contains(&error.code().0) => Ok(()),
                Err(error) => Err(failed(error)),
            }
        });
        shown.join().unwrap_or_else(|_| Err(CertificateError::Failed("the certificate's window closed unexpectedly".into())))
    }

    pub fn check_revocation(certificates: &[Vec<u8>]) -> Result<Revocation, CertificateError> {
        let carried = Carried::of(certificates)?;
        let parameters = CERT_CHAIN_PARA { cbSize: size_of::<CERT_CHAIN_PARA>() as u32, dwUrlRetrievalTimeout: ISSUER_TIME_LIMIT, ..Default::default() };
        let mut chain: *mut CERT_CHAIN_CONTEXT = ptr::null_mut();
        // Online: Windows asks the issuers each certificate names (and fetches one that issued it, when missing).
        // SAFETY: every pointer is valid for the call; the chain is freed by `Drop`.
        unsafe { CertGetCertificateChain(None, carried.first, None, Some(carried.store.0), &parameters, CERT_CHAIN_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT, None, &mut chain) }.map_err(failed)?;
        if chain.is_null() {
            return Ok(Revocation::Unknown);
        }
        let chain = Chain(chain);
        // SAFETY: the chain is live.
        let errors = unsafe { (*chain.0).TrustStatus.dwErrorStatus };
        Ok(if errors & CERT_TRUST_IS_REVOKED != 0 {
            Revocation::Revoked
        } else if errors & (CERT_TRUST_REVOCATION_STATUS_UNKNOWN | CERT_TRUST_IS_OFFLINE_REVOCATION | CERT_TRUST_IS_PARTIAL_CHAIN) != 0 {
            Revocation::Unknown
        } else {
            Revocation::Good
        })
    }

    pub fn chain_of(source: Source<'_>) -> Result<Vec<Vec<u8>>, CertificateError> {
        with_signer(source, |certificate| {
            // SAFETY: a live context names the store it is in.
            let chain = Chain::of(certificate, Some(unsafe { (*certificate).hCertStore }));
            let found: Vec<Vec<u8>> = chain.as_ref().map(Chain::certificates).unwrap_or_default().into_iter().map(|each| encoded(each)).collect();
            Ok(if found.is_empty() { vec![encoded(certificate)] } else { found })
        })
    }

    pub fn sign_detached(source: Source<'_>, parts: &[&[u8]], attributes: &[(&str, &[u8])]) -> Result<Vec<u8>, CertificateError> {
        with_signer(source, |certificate| {
            let fingerprint: [u8; 32] = property(certificate, CERT_SHA256_HASH_PROP_ID)
                .and_then(|hash| hash.try_into().ok())
                .ok_or_else(|| CertificateError::Failed("the certificate has no fingerprint".into()))?;
            // Each attribute: its name as Windows reads it (ending in a zero), and its value. The signing certificate's first.
            let mut names: Vec<Vec<u8>> = vec![SIGNING_CERTIFICATE_V2.to_vec()];
            let mut values: Vec<Vec<u8>> = vec![signing_certificate_v2(&fingerprint)];
            for (name, value) in attributes {
                names.push(format!("{name}\0").into_bytes());
                values.push(value.to_vec());
            }
            let mut blobs = values
                .iter_mut()
                .map(|value| Ok(CRYPT_INTEGER_BLOB { cbData: length(value.len())?, pbData: value.as_mut_ptr() }))
                .collect::<Result<Vec<_>, CertificateError>>()?;
            let mut signed_attributes: Vec<CRYPT_ATTRIBUTE> =
                names.iter_mut().zip(blobs.iter_mut()).map(|(name, blob)| CRYPT_ATTRIBUTE { pszObjId: PSTR(name.as_mut_ptr()), cValue: 1, rgValue: blob }).collect();

            // The certificates that lead up to the signer's go into the signature, so a reader can follow them.
            // SAFETY: a live context names the store it is in.
            let chain = Chain::of(certificate, Some(unsafe { (*certificate).hCertStore }));
            let mut included = chain.as_ref().map(Chain::certificates).unwrap_or_default();
            if included.is_empty() {
                included.push(certificate.cast_mut());
            }

            let mut parameters = CRYPT_SIGN_MESSAGE_PARA {
                cbSize: size_of::<CRYPT_SIGN_MESSAGE_PARA>() as u32,
                dwMsgEncodingType: ENCODING,
                pSigningCert: certificate,
                cMsgCert: length(included.len())?,
                rgpMsgCert: included.as_mut_ptr(),
                cAuthAttr: length(signed_attributes.len())?,
                rgAuthAttr: signed_attributes.as_mut_ptr(),
                ..Default::default()
            };
            parameters.HashAlgorithm.pszObjId = PSTR(SHA256.as_ptr().cast_mut());

            let pointers: Vec<*const u8> = parts.iter().map(|part| part.as_ptr()).collect();
            let sizes = parts.iter().map(|part| length(part.len())).collect::<Result<Vec<u32>, _>>()?;
            let count = length(parts.len())?;
            let mut size = 0_u32;
            // SAFETY: asks for the size; pointers and sizes describe `parts`, which outlive the call.
            unsafe { CryptSignMessage(&parameters, true, count, Some(pointers.as_ptr()), sizes.as_ptr(), None, &mut size) }.map_err(failed)?;
            let mut signature = vec![0_u8; size as usize];
            // Here Windows asks for the PIN of a card or a token, in a window of its own.
            // SAFETY: the buffer is as large as the size just answered.
            unsafe { CryptSignMessage(&parameters, true, count, Some(pointers.as_ptr()), sizes.as_ptr(), Some(signature.as_mut_ptr()), &mut size) }.map_err(failed)?;
            signature.truncate(size as usize);
            Ok(signature)
        })
    }

    pub fn verify_detached(signature: &[u8], parts: &[&[u8]]) -> Result<Verified, CertificateError> {
        // The certificates the signature carries: who signed is among them.
        // SAFETY: the slice is passed with its length.
        let carried = unsafe { CryptGetMessageCertificates(ENCODING, None, 0, signature) }.map(Store).map_err(|_| CertificateError::Failed("not a signature".into()))?;

        let parameters = CRYPT_VERIFY_MESSAGE_PARA { cbSize: size_of::<CRYPT_VERIFY_MESSAGE_PARA>() as u32, dwMsgAndCertEncodingType: ENCODING, ..Default::default() };
        let pointers: Vec<*const u8> = parts.iter().map(|part| part.as_ptr()).collect();
        let sizes = parts.iter().map(|part| length(part.len())).collect::<Result<Vec<u32>, _>>()?;
        let mut signer: *mut CERT_CONTEXT = ptr::null_mut();
        // SAFETY: pointers and sizes describe `parts`; the signer's certificate is freed below.
        let intact = unsafe { CryptVerifyDetachedMessageSignature(&parameters, 0, signature, length(parts.len())?, pointers.as_ptr(), sizes.as_ptr(), Some(&mut signer)) }.is_ok();

        if signer.is_null() {
            // The bytes were changed, or the signature is broken: say at least whose certificates it carries.
            let mut first = None;
            carried.each(|certificate| {
                if first.is_none() {
                    first = Some(describe(certificate));
                }
                true
            });
            let (signer, issuer) = first.map(|certificate| (certificate.subject, certificate.issuer)).unwrap_or_default();
            return Ok(Verified { intact: false, signer, issuer, trust: Trust::Untrusted });
        }
        let described = describe(signer);
        let trust = Chain::of(signer, Some(carried.0)).map_or(Trust::Untrusted, |chain| chain.trust());
        // SAFETY: the verification handed this context to us.
        let _ = unsafe { CertFreeCertificateContext(Some(signer)) };
        Ok(Verified { intact, signer: described.subject, issuer: described.issuer, trust })
    }

    pub fn verify_time_stamp(token: &[u8], parts: &[&[u8]]) -> Result<VerifiedTimeStamp, CertificateError> {
        // The certificates the stamp carries: the authority's is among them.
        // SAFETY: the slice is passed with its length.
        let carried = unsafe { CryptGetMessageCertificates(ENCODING, None, 0, token) }.map(Store).map_err(|_| CertificateError::Failed("not a time stamp".into()))?;
        let data = parts.concat();
        let mut context: *mut CRYPT_TIMESTAMP_CONTEXT = ptr::null_mut();
        let mut authority: *mut CERT_CONTEXT = ptr::null_mut();
        let mut store = HCERTSTORE::default();
        // Windows checks the authority's signature, and that the stamp is of these bytes (by the fingerprint it holds).
        // SAFETY: the slices are passed with their lengths; what it hands back is freed below.
        let intact = unsafe { CryptVerifyTimeStampSignature(token, Some(&data), Some(carried.0), &mut context, &mut authority, Some(&mut store as *mut HCERTSTORE)) }.is_ok();
        if !context.is_null() {
            // SAFETY: the context was made by the call above and is freed once.
            unsafe { CryptMemFree(Some(context.cast::<c_void>().cast_const())) };
        }
        let _keep_open_while_read = (!store.is_invalid()).then_some(Store(store));

        if authority.is_null() {
            // A stamp that is not of these bytes, or broken: say at least whose certificates it carries.
            let mut first = None;
            carried.each(|certificate| {
                if first.is_none() {
                    first = Some(describe(certificate));
                }
                true
            });
            return Ok(VerifiedTimeStamp { intact: false, authority: first.map(|certificate| certificate.subject).unwrap_or_default(), trust: Trust::Untrusted });
        }
        let described = describe(authority);
        let trust = Chain::of(authority, Some(carried.0)).map_or(Trust::Untrusted, |chain| chain.trust());
        // SAFETY: the verification handed this context to us.
        let _ = unsafe { CertFreeCertificateContext(Some(authority)) };
        Ok(VerifiedTimeStamp { intact, authority: described.subject, trust })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_signing_certificate_as_pades_asks() {
        let encoded = signing_certificate_v2(&[7; 32]);
        assert_eq!(encoded.len(), 40);
        // Three sequences around one octet string of 32 bytes.
        assert_eq!(encoded[..8], [0x30, 0x26, 0x30, 0x24, 0x30, 0x22, 0x04, 0x20]);
        assert_eq!(encoded[8..], [7; 32]);
    }
}
