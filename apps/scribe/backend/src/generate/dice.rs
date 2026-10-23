//! Where the generators take their randomness from.

/// Numbers that cannot be guessed, from the operating system; or, for tests, the same numbers for the same seed.
pub struct Dice {
    source: Source,
}

enum Source {
    /// Bytes from the operating system, taken a block at a time.
    System { block: [u8; 256], used: usize },
    Seeded(u64),
}

impl Dice {
    /// Randomness of the operating system: what passwords are made of.
    pub fn system() -> Self {
        Self { source: Source::System { block: [0; 256], used: 256 } }
    }

    /// The same numbers every time for the same seed. Not for anything that must stay secret.
    pub fn seeded(seed: u64) -> Self {
        Self { source: Source::Seeded(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1) }
    }

    fn next(&mut self) -> u64 {
        match &mut self.source {
            Source::System { block, used } => {
                if *used + 8 > block.len() {
                    // Without the system's randomness nothing here would be worth having.
                    getrandom::fill(block).expect("the operating system gives random bytes");
                    *used = 0;
                }
                let mut bytes = [0u8; 8];
                bytes.copy_from_slice(&block[*used..*used + 8]);
                *used += 8;
                u64::from_le_bytes(bytes)
            }
            Source::Seeded(state) => {
                // xorshift64*: small, and good enough to fill a page with words.
                *state ^= *state >> 12;
                *state ^= *state << 25;
                *state ^= *state >> 27;
                state.wrapping_mul(0x2545_F491_4F6C_DD1D)
            }
        }
    }

    /// A number from 0 up to, not including, `limit`; every one as likely as the others.
    pub fn below(&mut self, limit: usize) -> usize {
        if limit <= 1 {
            return 0;
        }
        let limit = limit as u64;
        // Numbers past the last whole run of `limit` are thrown again, so none comes up more often.
        let fair = u64::MAX - u64::MAX % limit;
        loop {
            let number = self.next();
            if number < fair {
                return (number % limit) as usize;
            }
        }
    }

    /// A number from `from` to `to`, both included.
    pub fn between(&mut self, from: usize, to: usize) -> usize {
        from + self.below(to.saturating_sub(from) + 1)
    }

    /// One of the items, each as likely as the others.
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len())]
    }

    /// Puts the items in a random order.
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for index in (1..items.len()).rev() {
            items.swap(index, self.below(index + 1));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gives_the_same_numbers_for_the_same_seed() {
        let (mut first, mut second) = (Dice::seeded(5), Dice::seeded(5));
        let thrown: Vec<usize> = (0..20).map(|_| first.below(100)).collect();
        assert_eq!(thrown, (0..20).map(|_| second.below(100)).collect::<Vec<_>>());
        assert!(thrown.iter().any(|number| *number != thrown[0]));
    }

    #[test]
    fn stays_inside_what_is_asked() {
        let mut dice = Dice::system();
        for _ in 0..2000 {
            assert!(dice.below(7) < 7);
            assert!((3..=5).contains(&dice.between(3, 5)));
        }
        assert_eq!(dice.below(0), 0);
        assert_eq!(dice.between(4, 4), 4);
    }

    #[test]
    fn the_system_does_not_repeat_itself() {
        let (mut first, mut second) = (Dice::system(), Dice::system());
        assert_ne!((0..8).map(|_| first.below(1 << 30)).collect::<Vec<_>>(), (0..8).map(|_| second.below(1 << 30)).collect::<Vec<_>>());
    }
}
