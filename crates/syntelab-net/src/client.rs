use std::time::Duration;

use ureq::http::header::LOCATION;
use ureq::Agent;

use crate::allow_list::is_allowed;
use crate::error::NetError;

/// The same for every user and every version: it identifies nobody.
const USER_AGENT: &str = "Syntelab Creative";
const TIME_LIMIT: Duration = Duration::from_secs(15);
/// The files read are small lists; anything larger is not one of them.
const SIZE_LIMIT: u64 = 2 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;

fn agent() -> Agent {
    Agent::config_builder()
        .https_only(true)
        .user_agent(USER_AGENT)
        .timeout_global(Some(TIME_LIMIT))
        // Redirects are followed by hand, so each new address is checked.
        .max_redirects(0)
        .max_redirects_will_error(false)
        .build()
        .into()
}

/// Reads a text file from an allowed address.
pub(crate) fn get_text(url: &str) -> Result<String, NetError> {
    get_text_where(url, is_allowed)
}

/// Reads a text file from an address that `allowed` accepts; every address a redirect leads to is asked of it too.
pub(crate) fn get_text_where(url: &str, allowed: fn(&str) -> bool) -> Result<String, NetError> {
    let agent = agent();
    let mut url = url.to_owned();

    for _ in 0..=MAX_REDIRECTS {
        if !allowed(&url) {
            return Err(NetError::NotAllowed(url));
        }
        let mut response = agent
            .get(&url)
            .call()
            .map_err(|error| NetError::Request(error.to_string()))?;

        if response.status().is_redirection() {
            url = response
                .headers()
                .get(LOCATION)
                .and_then(|location| location.to_str().ok())
                .ok_or_else(|| NetError::Request("redirect without an address".to_owned()))?
                .to_owned();
            continue;
        }

        return response
            .body_mut()
            .with_config()
            .limit(SIZE_LIMIT)
            .read_to_string()
            .map_err(|error| NetError::Request(error.to_string()));
    }
    Err(NetError::TooManyRedirects)
}
