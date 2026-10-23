//! A JSON Web Token (RFC 7519) taken apart: its header and its payload as JSON, and its signature checked when
//! it was made with a shared secret (HS256, HS384, HS512).
//!
//! Nothing is fetched and nothing is trusted: the token is only read. A
//! signature made with a private key (RS, PS, ES, EdDSA) is told of and not
//! checked here.

use sha2::{Digest, Sha256, Sha384, Sha512};

use crate::base64;
use crate::codec::{CodecError, Stage, Wrong};
use crate::json;

/// How the signature of a token stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signature {
    /// Made with the secret that was given.
    Valid,
    /// Not made with the secret that was given, or the token was changed since.
    Invalid,
    /// It could be checked, but no secret was given.
    NotChecked,
    /// The token says it has none (`alg` is `none`).
    None,
    /// Made with a kind of key this tool does not check yet.
    Unsupported,
}

impl Signature {
    pub fn code(self) -> &'static str {
        match self {
            Signature::Valid => "valid",
            Signature::Invalid => "invalid",
            Signature::NotChecked => "not-checked",
            Signature::None => "none",
            Signature::Unsupported => "unsupported",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Token {
    /// The header and the payload, each written as indented JSON.
    pub header: String,
    pub payload: String,
    /// What the header says the token was signed with.
    pub algorithm: String,
    pub signature: Signature,
}

/// A part of a token (Base64 for URLs, without filling) as the bytes it stands for.
fn part(text: &str, code: &'static str) -> Result<Vec<u8>, Wrong> {
    let mut bytes = Vec::new();
    let mut decode = base64::Decode::default();
    let read = decode.push(text.as_bytes(), &mut bytes).and_then(|()| decode.finish(&mut bytes));
    match read {
        Ok(()) => Ok(bytes),
        Err(CodecError::Wrong(_)) => Err(Wrong::nowhere(code)),
        Err(_) => Err(Wrong::nowhere("failed")),
    }
}

/// A part that must be JSON, written again indented.
fn as_json(bytes: &[u8], code: &'static str) -> Result<String, Wrong> {
    let text = std::str::from_utf8(bytes).map_err(|_| Wrong::nowhere(code))?;
    match json::transform_text(text, json::Style::Spaces(2), &mut |_| true) {
        Ok((written, _)) if written.starts_with('{') => Ok(written),
        _ => Err(Wrong::nowhere(code)),
    }
}

/// HMAC (RFC 2104) with one of the SHA-2 hashes; `block` is the size of the blocks the hash works on.
fn hmac<D: Digest>(key: &[u8], message: &[u8], block: usize) -> Vec<u8> {
    let mut padded = vec![0u8; block];
    if key.len() > block {
        let short = D::digest(key);
        padded[..short.len()].copy_from_slice(&short);
    } else {
        padded[..key.len()].copy_from_slice(key);
    }
    let inner = D::new().chain_update(padded.iter().map(|byte| byte ^ 0x36).collect::<Vec<u8>>()).chain_update(message).finalize();
    D::new().chain_update(padded.iter().map(|byte| byte ^ 0x5c).collect::<Vec<u8>>()).chain_update(inner).finalize().to_vec()
}

/// True when two signatures are the same, in a time that does not depend on where they differ.
fn same(first: &[u8], second: &[u8]) -> bool {
    first.len() == second.len() && first.iter().zip(second).fold(0u8, |differs, (a, b)| differs | (a ^ b)) == 0
}

/// Reads a token. `secret` is the bytes it may have been signed with; none when there is nothing to check it with.
pub fn read(token: &str, secret: Option<&[u8]>) -> Result<Token, Wrong> {
    let token = token.trim();
    // What is often pasted with it: the word that goes before a token in a request.
    let token = token.strip_prefix("Bearer ").map(str::trim_start).unwrap_or(token);
    if token.is_empty() {
        return Err(Wrong::nowhere("empty"));
    }
    let parts: Vec<&str> = token.split('.').collect();
    match parts.len() {
        3 => {}
        // Five parts: a token that is encrypted (JWE), not only signed. There is nothing to read without its key.
        5 => return Err(Wrong::nowhere("encrypted")),
        _ => return Err(Wrong::nowhere("not-three-parts")),
    }
    let header_bytes = part(parts[0], "bad-header")?;
    let header = as_json(&header_bytes, "bad-header")?;
    let payload = as_json(&part(parts[1], "bad-payload")?, "bad-payload")?;
    let signed_with = part(parts[2], "bad-signature")?;
    let algorithm = serde_json::from_slice::<serde_json::Value>(&header_bytes).ok().and_then(|header| header.get("alg").and_then(|alg| alg.as_str().map(str::to_owned))).unwrap_or_default();

    let message = &token.as_bytes()[..parts[0].len() + 1 + parts[1].len()];
    let made = |secret: &[u8]| match algorithm.as_str() {
        "HS256" => Some(hmac::<Sha256>(secret, message, 64)),
        "HS384" => Some(hmac::<Sha384>(secret, message, 128)),
        "HS512" => Some(hmac::<Sha512>(secret, message, 128)),
        _ => None,
    };
    let signature = match (algorithm.as_str(), secret) {
        ("none", _) => Signature::None,
        ("HS256" | "HS384" | "HS512", None) => Signature::NotChecked,
        ("HS256" | "HS384" | "HS512", Some(secret)) => {
            if made(secret).is_some_and(|made| same(&made, &signed_with)) {
                Signature::Valid
            } else {
                Signature::Invalid
            }
        }
        _ => Signature::Unsupported,
    };
    Ok(Token { header, payload, algorithm, signature })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The token of RFC 7515, appendix A.1, and the key it was signed with.
    const TOKEN: &str = "eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const KEY: &str = "AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow";

    fn key() -> Vec<u8> {
        part(KEY, "bad").expect("a key")
    }

    #[test]
    fn hmac_gives_the_answers_of_its_standard() {
        // RFC 4231, test case 2.
        let hex = |bytes: Vec<u8>| bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        assert_eq!(hex(hmac::<Sha256>(b"Jefe", b"what do ya want for nothing?", 64)), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
        assert_eq!(hex(hmac::<Sha512>(b"Jefe", b"what do ya want for nothing?", 128)), "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737");
        // Test case 6: a key longer than a block is hashed first.
        assert_eq!(hex(hmac::<Sha256>(&[0xaa; 131], b"Test Using Larger Than Block-Size Key - Hash Key First", 64)), "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
    }

    #[test]
    fn reads_the_token_of_the_standard_and_checks_it() {
        let token = read(TOKEN, Some(&key())).expect("a token");
        assert_eq!(token.header, "{\n  \"typ\": \"JWT\",\n  \"alg\": \"HS256\"\n}");
        assert_eq!(token.payload, "{\n  \"iss\": \"joe\",\n  \"exp\": 1300819380,\n  \"http://example.com/is_root\": true\n}");
        assert_eq!((token.algorithm.as_str(), token.signature), ("HS256", Signature::Valid));
        assert_eq!(read(TOKEN, Some(b"another secret")).expect("a token").signature, Signature::Invalid);
        assert_eq!(read(TOKEN, None).expect("a token").signature, Signature::NotChecked);
        assert_eq!(read(&format!("  Bearer {TOKEN}\n"), Some(&key())).expect("a token").signature, Signature::Valid);
        // One digit of the payload changed: the signature is no longer of this token.
        assert_eq!(read(&TOKEN.replacen("MTkzODAs", "MTkzODEs", 1), Some(&key())).map(|token| token.signature), Ok(Signature::Invalid));
    }

    #[test]
    fn tells_of_the_tokens_it_does_not_check() {
        // `{"alg":"RS256"}` and `{"alg":"none"}`, with `{}` as the payload.
        assert_eq!(read("eyJhbGciOiJSUzI1NiJ9.e30.c2ln", Some(b"x")).expect("a token").signature, Signature::Unsupported);
        assert_eq!(read("eyJhbGciOiJub25lIn0.e30.", None).expect("a token").signature, Signature::None);
    }

    #[test]
    fn says_what_is_wrong() {
        let code = |token: &str| read(token, None).expect_err("not a token").code;
        assert_eq!(code(""), "empty");
        assert_eq!(code("abc.def"), "not-three-parts");
        assert_eq!(code("a.b.c.d.e"), "encrypted");
        assert_eq!(code("!!!.e30.c2ln"), "bad-header");
        // `[1]` is JSON, and no header.
        assert_eq!(code("WzFd.e30.c2ln"), "bad-header");
        assert_eq!(code("eyJhbGciOiJub25lIn0.bm90IGpzb24.c2ln"), "bad-payload");
        assert_eq!(code("eyJhbGciOiJub25lIn0.e30.*"), "bad-signature");
    }
}
