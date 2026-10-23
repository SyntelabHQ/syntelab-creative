use ureq::http::Uri;

/// The only hosts the program contacts.
const ALLOWED_HOSTS: [&str; 2] = ["syntelab.com", "www.syntelab.com"];

/// The two services the rates of exchange are read from (see `rates.rs`): asked only by the currency converter.
const RATE_HOSTS: [&str; 2] = ["open.er-api.com", "api.coingecko.com"];

/// True for an HTTPS address on one of the allowed hosts, on the standard port.
pub fn is_allowed(url: &str) -> bool {
    is_on(url, &ALLOWED_HOSTS)
}

/// True for an HTTPS address of one of the two services of rates, on the standard port.
pub(crate) fn is_rate_service(url: &str) -> bool {
    is_on(url, &RATE_HOSTS)
}

fn is_on(url: &str, hosts: &[&str]) -> bool {
    let Ok(uri) = url.parse::<Uri>() else {
        return false;
    };
    let https = uri.scheme_str() == Some("https");
    let host = uri.host().is_some_and(|host| hosts.contains(&host));
    // user:password@host addresses are refused along with odd ports.
    let plain_authority = uri.authority().is_some_and(|authority| Some(authority.as_str()) == uri.host());
    https && host && plain_authority
}

#[cfg(test)]
mod tests {
    use super::is_allowed;

    #[test]
    fn accepts_https_on_the_site() {
        assert!(is_allowed("https://syntelab.com/creative/check/update.json"));
        assert!(is_allowed("https://www.syntelab.com/creative/check/update.json"));
    }

    #[test]
    fn refuses_everything_else() {
        assert!(!is_allowed("http://syntelab.com/creative/check/update.json"));
        assert!(!is_allowed("https://example.com/update.json"));
        assert!(!is_allowed("https://syntelab.com.example.com/update.json"));
        assert!(!is_allowed("https://evil@syntelab.com/update.json"));
        assert!(!is_allowed("https://syntelab.com:8443/update.json"));
        assert!(!is_allowed("/creative/check/update.json"));
        assert!(!is_allowed("not an address"));
    }
}
