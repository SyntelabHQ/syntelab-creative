//! Percent-encoding, both ways, as bytes come.
//!
//! Three ways of writing, each the one browsers have:
//! - a part of an address (`encodeURIComponent`): everything but letters, digits and `- _ . ! ~ * ' ( )`;
//! - a whole address (`encodeURI`): the signs that hold an address together are left as they are too;
//! - a form (`application/x-www-form-urlencoded`): a space is `+`, and only letters, digits and `* - . _` are left.
//!
//! Read back, every `%XX` is its byte, whichever way it was written; in a form, `+` is a space.

use std::io::Write;

use crate::codec::{CodecError, Place, Stage};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Way {
    Component,
    WholeAddress,
    Form,
}

impl Way {
    /// The byte is written as it is.
    fn keeps(self, byte: u8) -> bool {
        if byte.is_ascii_alphanumeric() {
            return true;
        }
        match self {
            Way::Component => b"-_.!~*'()".contains(&byte),
            Way::WholeAddress => b"-_.!~*'();/?:@&=+$,#".contains(&byte),
            Way::Form => b"*-._".contains(&byte),
        }
    }
}

const HEX: &[u8; 16] = b"0123456789ABCDEF";

pub struct Encode {
    way: Way,
}

impl Encode {
    pub fn new(way: Way) -> Self {
        Encode { way }
    }
}

impl Stage for Encode {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let mut written = Vec::with_capacity(piece.len() + piece.len() / 2);
        for &byte in piece {
            if self.way.keeps(byte) {
                written.push(byte);
            } else if byte == b' ' && self.way == Way::Form {
                written.push(b'+');
            } else {
                written.extend_from_slice(&[b'%', HEX[usize::from(byte >> 4)], HEX[usize::from(byte & 15)]]);
            }
        }
        out.write_all(&written).map_err(Into::into)
    }

    fn finish(&mut self, _out: &mut dyn Write) -> Result<(), CodecError> {
        Ok(())
    }
}

pub struct Decode {
    way: Way,
    /// After a `%`: the hexadecimal digits read so far (none, or the first of two).
    escape: Option<Option<u8>>,
    /// Where the `%` that is being read stands: a bad one is told at its own place.
    escape_at: Place,
    place: Place,
}

impl Decode {
    pub fn new(way: Way) -> Self {
        Decode { way, escape: None, escape_at: Place::default(), place: Place::default() }
    }
}

fn hex_value(byte: u8) -> Option<u8> {
    (byte as char).to_digit(16).map(|digit| digit as u8)
}

impl Stage for Decode {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let mut written = Vec::with_capacity(piece.len());
        for &byte in piece {
            match self.escape {
                None if byte == b'%' => {
                    self.escape = Some(None);
                    self.escape_at = self.place;
                }
                None if byte == b'+' && self.way == Way::Form => written.push(b' '),
                None => written.push(byte),
                Some(first) => {
                    let Some(digit) = hex_value(byte) else { return Err(self.escape_at.wrong("bad-percent").into()) };
                    match first {
                        None => self.escape = Some(Some(digit)),
                        Some(high) => {
                            written.push((high << 4) | digit);
                            self.escape = None;
                        }
                    }
                }
            }
            self.place.pass(byte);
        }
        out.write_all(&written).map_err(Into::into)
    }

    fn finish(&mut self, _out: &mut dyn Write) -> Result<(), CodecError> {
        if self.escape.is_some() {
            return Err(self.escape_at.wrong("bad-percent").into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::{problem, through};

    fn encoded(text: &str, way: Way) -> String {
        String::from_utf8(through(&mut Encode::new(way), text.as_bytes(), 3).expect("encoded")).expect("text")
    }

    fn decoded(text: &str, way: Way, at_once: usize) -> Result<Vec<u8>, CodecError> {
        through(&mut Decode::new(way), text.as_bytes(), at_once)
    }

    #[test]
    fn writes_as_browsers_do() {
        let text = "a b&c=d/é?x#y+z~(1)*'!";
        // What `encodeURIComponent`, `encodeURI` and `new URLSearchParams({ q: text })` give.
        assert_eq!(encoded(text, Way::Component), "a%20b%26c%3Dd%2F%C3%A9%3Fx%23y%2Bz~(1)*'!");
        assert_eq!(encoded(text, Way::WholeAddress), "a%20b&c=d/%C3%A9?x#y+z~(1)*'!");
        assert_eq!(encoded(text, Way::Form), "a+b%26c%3Dd%2F%C3%A9%3Fx%23y%2Bz%7E%281%29*%27%21");
    }

    #[test]
    fn reads_back_what_it_wrote() {
        let text = "a b&c=d/é?x#y+z~(1)*'!\n😀";
        for way in [Way::Component, Way::WholeAddress, Way::Form] {
            for at_once in 1..=4 {
                assert_eq!(decoded(&encoded(text, way), way, at_once).expect("decoded"), text.as_bytes());
            }
        }
        assert_eq!(decoded("a+b%2b", Way::Component, 2).expect("decoded"), b"a+b+");
        assert_eq!(decoded("a+b%2b", Way::Form, 2).expect("decoded"), b"a b+");
    }

    #[test]
    fn says_where_a_bad_percent_is() {
        assert_eq!(problem(decoded("ab%zz", Way::Component, 2)), ("bad-percent", 1, 3));
        assert_eq!(problem(decoded("100%", Way::Component, 2)), ("bad-percent", 1, 4));
        assert_eq!(problem(decoded("a\nb%4", Way::Component, 1)), ("bad-percent", 2, 2));
    }
}
