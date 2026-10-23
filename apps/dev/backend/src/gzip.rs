//! Gzip (RFC 1952), both ways, as bytes come. The squeezing itself is `flate2`'s.
//!
//! What is squeezed is bytes, which a text box cannot hold: so it can be
//! written as Base64, and what is given to be unsqueezed may be Base64 too.
//! Which of the two it is, is told by its first bytes.

use std::io::Write;

use flate2::write::{GzEncoder, MultiGzDecoder};
use flate2::Compression;

use crate::base64;
use crate::codec::{CodecError, Stage, Wrong};

/// What `flate2` wrote since it was last asked, handed on.
fn hand_on(written: &mut Vec<u8>, next: Option<&mut base64::Encode>, out: &mut dyn Write) -> Result<(), CodecError> {
    match next {
        Some(as_text) => as_text.push(written, out)?,
        None => out.write_all(written)?,
    }
    written.clear();
    Ok(())
}

pub struct Compress {
    squeezer: Option<GzEncoder<Vec<u8>>>,
    /// The squeezed bytes are written as Base64.
    as_text: Option<base64::Encode>,
}

impl Compress {
    /// `level` from 1 (fastest) to 9 (smallest).
    pub fn new(level: u32, as_text: bool) -> Self {
        Compress { squeezer: Some(GzEncoder::new(Vec::new(), Compression::new(level.clamp(1, 9)))), as_text: as_text.then(|| base64::Encode::new(false, true, 0)) }
    }
}

impl Stage for Compress {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let Some(squeezer) = self.squeezer.as_mut() else { return Ok(()) };
        squeezer.write_all(piece)?;
        hand_on(squeezer.get_mut(), self.as_text.as_mut(), out)
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        let Some(squeezer) = self.squeezer.take() else { return Ok(()) };
        let mut last = squeezer.finish()?;
        hand_on(&mut last, self.as_text.as_mut(), out)?;
        match self.as_text.as_mut() {
            Some(as_text) => as_text.finish(out),
            None => Ok(()),
        }
    }
}

/// The two bytes every gzip file starts with.
const MAGIC: [u8; 2] = [0x1f, 0x8b];

/// What is being unsqueezed turned out not to be gzip, or to be cut short.
fn bad(error: std::io::Error) -> CodecError {
    match error.kind() {
        std::io::ErrorKind::InvalidInput | std::io::ErrorKind::InvalidData | std::io::ErrorKind::UnexpectedEof | std::io::ErrorKind::WriteZero => Wrong::nowhere("bad-gzip").into(),
        _ => error.into(),
    }
}

pub struct Decompress {
    /// Until the first two bytes are seen, it is not known whether what is given is gzip itself or Base64 of it.
    first: Vec<u8>,
    /// Base64 is read into bytes first.
    from_text: Option<base64::Decode>,
    opener: Option<MultiGzDecoder<Vec<u8>>>,
    decided: bool,
}

impl Default for Decompress {
    fn default() -> Self {
        Decompress { first: Vec::new(), from_text: None, opener: Some(MultiGzDecoder::new(Vec::new())), decided: false }
    }
}

impl Decompress {
    fn open(&mut self, bytes: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let Some(opener) = self.opener.as_mut() else { return Ok(()) };
        opener.write_all(bytes).map_err(bad)?;
        out.write_all(opener.get_ref())?;
        opener.get_mut().clear();
        Ok(())
    }

    fn feed(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        if self.from_text.is_none() {
            return self.open(piece, out);
        }
        let mut bytes = Vec::new();
        if let Some(from_text) = self.from_text.as_mut() {
            // Letters that are not Base64 either: what was given is simply not gzip.
            from_text.push(piece, &mut bytes).map_err(|_| Wrong::nowhere("bad-gzip"))?;
        }
        self.open(&bytes, out)
    }
}

impl Stage for Decompress {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        if self.decided {
            return self.feed(piece, out);
        }
        self.first.extend_from_slice(piece);
        if self.first.len() < MAGIC.len() {
            return Ok(());
        }
        self.decided = true;
        if !self.first.starts_with(&MAGIC) {
            self.from_text = Some(base64::Decode::default());
        }
        let first = std::mem::take(&mut self.first);
        self.feed(&first, out)
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        if !self.decided {
            // Fewer than two bytes: nothing that could be gzip.
            return Err(Wrong::nowhere(if self.first.is_empty() { "empty" } else { "bad-gzip" }).into());
        }
        if let Some(mut from_text) = self.from_text.take() {
            let mut bytes = Vec::new();
            from_text.finish(&mut bytes).map_err(|_| Wrong::nowhere("bad-gzip"))?;
            self.open(&bytes, out)?;
        }
        let Some(opener) = self.opener.take() else { return Ok(()) };
        let last = opener.finish().map_err(bad)?;
        out.write_all(&last).map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::through;

    fn squeezed(bytes: &[u8], as_text: bool, at_once: usize) -> Vec<u8> {
        through(&mut Compress::new(6, as_text), bytes, at_once).expect("squeezed")
    }

    #[test]
    fn what_is_squeezed_opens_to_the_same() {
        let text: Vec<u8> = "the quick brown fox jumps over the lazy dog é😀\n".repeat(2000).into_bytes();
        for at_once in [1, 7, 4096, 1 << 20] {
            let small = squeezed(&text, false, at_once);
            assert!(small.starts_with(&MAGIC) && small.len() < text.len() / 20);
            assert_eq!(through(&mut Decompress::default(), &small, at_once).expect("opened"), text, "{at_once} at a time");
        }
    }

    #[test]
    fn reads_what_other_tools_wrote() {
        // `printf hello | gzip -9 | base64`, with the time and the system the tool put in its head.
        let from_gzip = "H4sIAAAAAAACA8tIzcnJBwCGphA2BQAAAA==";
        assert_eq!(through(&mut Decompress::default(), from_gzip.as_bytes(), 5).expect("opened"), b"hello");
    }

    #[test]
    fn base64_both_ways_and_several_members() {
        let as_text = squeezed(b"hello, hello, hello", true, 4);
        assert!(as_text.starts_with(b"H4sI"));
        assert_eq!(through(&mut Decompress::default(), &as_text, 3).expect("opened"), b"hello, hello, hello");
        // Two gzip files end to end are one text, as `zcat` reads them.
        let mut two = squeezed(b"one ", false, 9);
        two.extend(squeezed(b"two", false, 9));
        assert_eq!(through(&mut Decompress::default(), &two, 6).expect("opened"), b"one two");
    }

    #[test]
    fn what_is_not_gzip_is_refused() {
        let wrong = |bytes: &[u8]| matches!(through(&mut Decompress::default(), bytes, 4), Err(CodecError::Wrong(_)));
        assert!(wrong(b"not gzip at all"));
        assert!(wrong(b""));
        assert!(wrong(b"x"));
        let whole = squeezed(b"hello hello hello hello", false, 9);
        assert!(wrong(&whole[..whole.len() - 6]));
        let mut broken = whole.clone();
        broken[12] ^= 0xff;
        assert!(wrong(&broken));
    }
}
