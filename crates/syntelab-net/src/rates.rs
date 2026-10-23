//! Rates of exchange, for the currency converter of Units.
//!
//! Two free services are asked, each at one fixed address: the rates of the
//! currencies of countries (ExchangeRate-API, once a day is all it changes),
//! and the prices of cryptocurrencies in dollars (CoinGecko). Only the rates
//! are asked for: nothing about the user, nor the amounts being converted,
//! is sent. The coins asked for are named by the data of the program, never
//! by what a user typed.

use crate::allow_list::is_rate_service;
use crate::client;
use crate::error::NetError;

/// Every currency of a country against the US dollar.
const FIAT_URL: &str = "https://open.er-api.com/v6/latest/USD";
/// The prices in US dollars of the coins named after `ids=`.
const COINS_URL: &str = "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=";
/// The most coins asked for at once, and the longest name of one.
const MOST_COINS: usize = 250;
const LONGEST_COIN: usize = 64;

/// A name of a coin as the service writes them: small letters, digits and hyphens.
fn is_coin(id: &str) -> bool {
    !id.is_empty() && id.len() <= LONGEST_COIN && id.bytes().all(|letter| letter.is_ascii_lowercase() || letter.is_ascii_digit() || letter == b'-')
}

/// The rates of the currencies of countries against the US dollar, as the service answers (JSON).
///
/// Blocks until the answer arrives or the time limit passes; call it from a worker thread.
pub fn fetch_fiat_rates() -> Result<String, NetError> {
    client::get_text_where(FIAT_URL, is_rate_service)
}

/// The prices of coins in US dollars, as the service answers (JSON). A name that is not one of a coin is refused.
pub fn fetch_coin_prices(coins: &[&str]) -> Result<String, NetError> {
    if coins.is_empty() || coins.len() > MOST_COINS || !coins.iter().all(|coin| is_coin(coin)) {
        return Err(NetError::NotAllowed("the names of the coins".to_owned()));
    }
    client::get_text_where(&format!("{COINS_URL}{}", coins.join(",")), is_rate_service)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_only_at_the_addresses_of_the_two_services() {
        assert!(is_rate_service(FIAT_URL));
        assert!(is_rate_service(&format!("{COINS_URL}bitcoin,usd-coin")));
        assert!(!is_rate_service("https://example.com/v6/latest/USD"));
        assert!(!is_rate_service("http://open.er-api.com/v6/latest/USD"));
        assert!(!crate::is_allowed(FIAT_URL), "the files of the program are read from its own site only");
    }

    #[test]
    fn refuses_names_that_are_not_coins() {
        assert!(is_coin("avalanche-2") && is_coin("bitcoin"));
        for wrong in ["", "Bitcoin", "a&b=c", "a,b", "a b", "../x"] {
            assert!(!is_coin(wrong), "{wrong}");
            assert!(matches!(fetch_coin_prices(&[wrong]), Err(NetError::NotAllowed(_))), "{wrong}");
        }
        assert!(matches!(fetch_coin_prices(&[]), Err(NetError::NotAllowed(_))));
    }
}
