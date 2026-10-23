//! Digests of what is given: CRC-32, MD5, SHA-1, SHA-256, SHA-384, SHA-512, several in one reading; HMAC with a
//! key; each line apart when asked; and the check of a digest that was given beside the file.
//!
//! What is hashed goes by a piece at a time and nothing of it is kept, so a file is as large as the disk lets it
//! be. The digests are those of the RustCrypto crates (`sha2`, `sha1`, `md-5`) and of `crc32fast`; HMAC (RFC 2104)
//! is put together here over them.

use std::io::Write;

use md5::Md5;
use sha1::Sha1;
use sha2::digest::core_api::BlockSizeUser;
use sha2::{Digest, Sha256, Sha384, Sha512};

use crate::codec::{CodecError, Stage, Wrong};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Algorithm {
    Crc32,
    Md5,
    Sha1,
    Sha256,
    Sha384,
    Sha512,
}

impl Algorithm {
    pub fn of(name: &str) -> Option<Algorithm> {
        Some(match name {
            "crc32" => Algorithm::Crc32,
            "md5" => Algorithm::Md5,
            "sha1" => Algorithm::Sha1,
            "sha256" => Algorithm::Sha256,
            "sha384" => Algorithm::Sha384,
            "sha512" => Algorithm::Sha512,
            _ => return None,
        })
    }

    /// As it is written beside a digest.
    pub fn name(self) -> &'static str {
        match self {
            Algorithm::Crc32 => "CRC-32",
            Algorithm::Md5 => "MD5",
            Algorithm::Sha1 => "SHA-1",
            Algorithm::Sha256 => "SHA-256",
            Algorithm::Sha384 => "SHA-384",
            Algorithm::Sha512 => "SHA-512",
        }
    }
}

/// A digest being made.
#[derive(Clone)]
enum Running {
    Crc32(crc32fast::Hasher),
    Md5(Md5),
    Sha1(Sha1),
    Sha256(Sha256),
    Sha384(Sha384),
    Sha512(Sha512),
}

impl Running {
    fn new(algorithm: Algorithm) -> Self {
        match algorithm {
            Algorithm::Crc32 => Running::Crc32(crc32fast::Hasher::new()),
            Algorithm::Md5 => Running::Md5(Md5::new()),
            Algorithm::Sha1 => Running::Sha1(Sha1::new()),
            Algorithm::Sha256 => Running::Sha256(Sha256::new()),
            Algorithm::Sha384 => Running::Sha384(Sha384::new()),
            Algorithm::Sha512 => Running::Sha512(Sha512::new()),
        }
    }

    fn update(&mut self, bytes: &[u8]) {
        match self {
            Running::Crc32(hasher) => hasher.update(bytes),
            Running::Md5(hasher) => hasher.update(bytes),
            Running::Sha1(hasher) => hasher.update(bytes),
            Running::Sha256(hasher) => hasher.update(bytes),
            Running::Sha384(hasher) => hasher.update(bytes),
            Running::Sha512(hasher) => hasher.update(bytes),
        }
    }

    fn finish(self) -> Vec<u8> {
        match self {
            Running::Crc32(hasher) => hasher.finalize().to_be_bytes().to_vec(),
            Running::Md5(hasher) => hasher.finalize().to_vec(),
            Running::Sha1(hasher) => hasher.finalize().to_vec(),
            Running::Sha256(hasher) => hasher.finalize().to_vec(),
            Running::Sha384(hasher) => hasher.finalize().to_vec(),
            Running::Sha512(hasher) => hasher.finalize().to_vec(),
        }
    }

    /// The size of the blocks the digest works on, which HMAC needs; none for what is no such digest (CRC-32).
    fn block(algorithm: Algorithm) -> Option<usize> {
        Some(match algorithm {
            Algorithm::Crc32 => return None,
            Algorithm::Md5 => Md5::block_size(),
            Algorithm::Sha1 => Sha1::block_size(),
            Algorithm::Sha256 => Sha256::block_size(),
            Algorithm::Sha384 => Sha384::block_size(),
            Algorithm::Sha512 => Sha512::block_size(),
        })
    }
}

/// One digest of what goes by: plain, or keyed (HMAC: the digest of the key and of the digest of the key and the message).
#[derive(Clone)]
struct One {
    algorithm: Algorithm,
    inner: Running,
    /// The key as the outer digest begins with it; none for a plain digest.
    outer: Option<Vec<u8>>,
}

impl One {
    fn new(algorithm: Algorithm, key: Option<&[u8]>) -> Option<One> {
        let Some(key) = key else { return Some(One { algorithm, inner: Running::new(algorithm), outer: None }) };
        let block = Running::block(algorithm)?;
        let mut padded = vec![0u8; block];
        if key.len() > block {
            let mut short = Running::new(algorithm);
            short.update(key);
            let short = short.finish();
            padded[..short.len()].copy_from_slice(&short);
        } else {
            padded[..key.len()].copy_from_slice(key);
        }
        let mut inner = Running::new(algorithm);
        inner.update(&padded.iter().map(|byte| byte ^ 0x36).collect::<Vec<u8>>());
        Some(One { algorithm, inner, outer: Some(padded.iter().map(|byte| byte ^ 0x5c).collect()) })
    }

    fn finish(self) -> Vec<u8> {
        let digest = self.inner.finish();
        match self.outer {
            None => digest,
            Some(outer) => {
                let mut last = Running::new(self.algorithm);
                last.update(&outer);
                last.update(&digest);
                last.finish()
            }
        }
    }
}

/// How a digest is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Form {
    Hex,
    UpperHex,
    Base64,
}

pub(crate) fn base64(bytes: &[u8]) -> String {
    const LETTERS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut written = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for group in bytes.chunks(3) {
        let bits = u32::from(group[0]) << 16 | u32::from(*group.get(1).unwrap_or(&0)) << 8 | u32::from(*group.get(2).unwrap_or(&0));
        for place in 0..4 {
            written.push(if place <= group.len() { char::from(LETTERS[(bits >> (18 - 6 * place) & 63) as usize]) } else { '=' });
        }
    }
    written
}

fn written(digest: &[u8], form: Form) -> String {
    match form {
        Form::Hex => digest.iter().map(|byte| format!("{byte:02x}")).collect(),
        Form::UpperHex => digest.iter().map(|byte| format!("{byte:02X}")).collect(),
        Form::Base64 => base64(digest),
    }
}

/// The digest in a line as programs write beside a file: `digest  name` (GNU), `NAME (file) = digest` (BSD), or the digest alone.
fn expected_of(given: &str) -> String {
    let line = given.lines().find(|line| !line.trim().is_empty()).unwrap_or_default().trim();
    match line.rsplit_once(" = ") {
        Some((_, digest)) => digest.trim().to_owned(),
        None => line.split_whitespace().next().unwrap_or_default().to_owned(),
    }
}

pub struct Hash {
    ones: Vec<One>,
    form: Form,
    /// Each line of what is given is hashed apart.
    lines: bool,
    /// The digest what is given should have, as it was given; none when there is nothing to check.
    expected: Option<String>,
    /// In `lines`: the digests of the line being read, and whether a carriage return waits to be told from a line ending.
    line: Vec<One>,
    waits: bool,
    any: bool,
    matched: Option<Option<Algorithm>>,
}

impl Hash {
    /// `key`: the digests are HMACs with this key (CRC-32 has none, and is left out). `expected`: a digest to check
    /// the result against, in any of the forms it is written in.
    pub fn new(algorithms: &[Algorithm], key: Option<&[u8]>, form: Form, lines: bool, expected: Option<&str>) -> Self {
        let ones: Vec<One> = algorithms.iter().filter_map(|algorithm| One::new(*algorithm, key)).collect();
        Hash { line: ones.clone(), ones, form, lines, expected: expected.map(expected_of).filter(|expected| !expected.is_empty()), waits: false, any: false, matched: None }
    }

    /// The digests of something that was read whole, each on a line (the name of the algorithm before it when there
    /// are several), or all on one line with tabs between when each line is hashed apart.
    fn write(&self, ones: Vec<One>, out: &mut dyn Write) -> Result<Vec<(Algorithm, Vec<u8>)>, CodecError> {
        let several = ones.len() > 1;
        let digests: Vec<(Algorithm, Vec<u8>)> = ones.into_iter().map(|one| (one.algorithm, one.finish())).collect();
        for (index, (algorithm, digest)) in digests.iter().enumerate() {
            if self.lines {
                if index > 0 {
                    out.write_all(b"\t")?;
                }
                out.write_all(written(digest, self.form).as_bytes())?;
            } else if several {
                writeln!(out, "{}: {}", algorithm.name(), written(digest, self.form))?;
            } else {
                writeln!(out, "{}", written(digest, self.form))?;
            }
        }
        if self.lines {
            out.write_all(b"\n")?;
        }
        Ok(digests)
    }

    fn line_done(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        let done = std::mem::replace(&mut self.line, self.ones.clone());
        self.write(done, out)?;
        self.any = false;
        Ok(())
    }
}

impl Stage for Hash {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        if !self.lines {
            self.ones.iter_mut().for_each(|one| one.inner.update(piece));
            return Ok(());
        }
        let mut rest = piece;
        while !rest.is_empty() {
            // A carriage return right before a line feed is part of the line ending; anywhere else it is of the line.
            if std::mem::take(&mut self.waits) && rest[0] != b'\n' {
                self.line.iter_mut().for_each(|one| one.inner.update(b"\r"));
            }
            let end = rest.iter().position(|&byte| byte == b'\n' || byte == b'\r').unwrap_or(rest.len());
            if end > 0 {
                self.line.iter_mut().for_each(|one| one.inner.update(&rest[..end]));
                self.any = true;
            }
            match rest.get(end) {
                Some(b'\n') => self.line_done(out)?,
                Some(_) => self.waits = true,
                None => {}
            }
            rest = &rest[(end + 1).min(rest.len())..];
        }
        Ok(())
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        if self.ones.is_empty() {
            return Err(Wrong::nowhere("no-algorithm").into());
        }
        if self.lines {
            if std::mem::take(&mut self.waits) {
                self.line.iter_mut().for_each(|one| one.inner.update(b"\r"));
                self.any = true;
            }
            // A last line that does not end is a line too.
            if self.any {
                self.line_done(out)?;
            }
            return Ok(());
        }
        let ones = std::mem::take(&mut self.ones);
        let digests = self.write(ones, out)?;
        if let Some(expected) = &self.expected {
            // Hexadecimal is the same in small letters and in capitals; Base64 is not.
            let same = |digest: &Vec<u8>| written(digest, Form::Hex).eq_ignore_ascii_case(expected) || base64(digest) == *expected;
            self.matched = Some(digests.iter().find(|(_, digest)| same(digest)).map(|(algorithm, _)| *algorithm));
        }
        Ok(())
    }

    fn notes(&self) -> Vec<(&'static str, String)> {
        match self.matched {
            Some(Some(algorithm)) => vec![("hash-match", format!("\n{}", algorithm.name()))],
            Some(None) => vec![("hash-no-match", String::new())],
            None => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::through;

    const ALL: [Algorithm; 6] = [Algorithm::Crc32, Algorithm::Md5, Algorithm::Sha1, Algorithm::Sha256, Algorithm::Sha384, Algorithm::Sha512];

    fn hashed(stage: &mut Hash, bytes: &[u8]) -> String {
        String::from_utf8(through(stage, bytes, 3).expect("hashed")).expect("text")
    }

    #[test]
    fn the_digests_are_those_everyone_knows() {
        // What `cksum -a crc`/`crc32`, `md5sum`, `sha1sum`, `sha256sum`, `sha384sum` and `sha512sum` give for "abc".
        assert_eq!(
            hashed(&mut Hash::new(&ALL, None, Form::Hex, false, None), b"abc"),
            "CRC-32: 352441c2\nMD5: 900150983cd24fb0d6963f7d28e17f72\nSHA-1: a9993e364706816aba3e25717850c26c9cd0d89d\nSHA-256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\nSHA-384: cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7\nSHA-512: ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f\n"
        );
        // Of nothing at all; and in the other forms.
        assert_eq!(hashed(&mut Hash::new(&[Algorithm::Sha256], None, Form::Hex, false, None), b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n");
        assert_eq!(hashed(&mut Hash::new(&[Algorithm::Md5], None, Form::UpperHex, false, None), b"abc"), "900150983CD24FB0D6963F7D28E17F72\n");
        assert_eq!(hashed(&mut Hash::new(&[Algorithm::Sha1], None, Form::Base64, false, None), b"abc"), "qZk+NkcGgWq6PiVxeFDCbJzQ2J0=\n");
    }

    #[test]
    fn hmac_gives_the_answers_of_its_standards() {
        // RFC 2202 (MD5 and SHA-1) and RFC 4231 (SHA-2), test case 2.
        let keyed = |algorithm| hashed(&mut Hash::new(&[algorithm], Some(b"Jefe"), Form::Hex, false, None), b"what do ya want for nothing?");
        assert_eq!(keyed(Algorithm::Md5), "750c783e6ab0b503eaa86e310a5db738\n");
        assert_eq!(keyed(Algorithm::Sha1), "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79\n");
        assert_eq!(keyed(Algorithm::Sha256), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843\n");
        assert_eq!(keyed(Algorithm::Sha384), "af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649\n");
        // RFC 4231, test case 6: a key longer than a block is hashed first.
        assert_eq!(hashed(&mut Hash::new(&[Algorithm::Sha256], Some(&[0xaa; 131]), Form::Hex, false, None), b"Test Using Larger Than Block-Size Key - Hash Key First"), "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54\n");
        // CRC-32 has no keyed form: it is left out, and alone it is nothing to make.
        assert_eq!(hashed(&mut Hash::new(&[Algorithm::Crc32, Algorithm::Md5], Some(b"Jefe"), Form::Hex, false, None), b"what do ya want for nothing?"), "750c783e6ab0b503eaa86e310a5db738\n");
        assert!(through(&mut Hash::new(&[Algorithm::Crc32], Some(b"k"), Form::Hex, false, None), b"x", 1).is_err());
    }

    #[test]
    fn each_line_is_hashed_apart() {
        let lines = hashed(&mut Hash::new(&[Algorithm::Md5, Algorithm::Crc32], None, Form::Hex, true, None), b"abc\r\n\nabc");
        assert_eq!(lines, "900150983cd24fb0d6963f7d28e17f72\t352441c2\nd41d8cd98f00b204e9800998ecf8427e\t00000000\n900150983cd24fb0d6963f7d28e17f72\t352441c2\n");
        // A carriage return that ends no line is of the line.
        assert_eq!(hashed(&mut Hash::new(&[Algorithm::Crc32], None, Form::Hex, true, None), b"a\rb\n"), format!("{:08x}\n", crc32fast::hash(b"a\rb")));
    }

    #[test]
    fn a_digest_given_is_checked_in_the_forms_it_is_written_in() {
        let checked = |expected: &str| {
            let mut stage = Hash::new(&[Algorithm::Md5, Algorithm::Sha256], None, Form::Hex, false, Some(expected));
            hashed(&mut stage, b"abc");
            stage.notes()
        };
        let sha = vec![("hash-match", "\nSHA-256".to_string())];
        assert_eq!(checked("BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"), sha);
        assert_eq!(checked("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  file.bin\n"), sha);
        assert_eq!(checked("SHA256 (file.bin) = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"), sha);
        assert_eq!(checked("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0="), sha);
        assert_eq!(checked("900150983cd24fb0d6963f7d28e17f72"), vec![("hash-match", "\nMD5".to_string())]);
        assert_eq!(checked("900150983cd24fb0d6963f7d28e17f73"), vec![("hash-no-match", String::new())]);
        assert!(checked("  \n").is_empty());
    }
}
