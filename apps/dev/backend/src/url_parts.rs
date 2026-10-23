//! A URL taken apart: its scheme, who it names, its host and what kind of host that is, its port, its path, each
//! parameter of its query as it is written and as it reads, and its fragment.
//!
//! The URL is read as browsers read it (the `url` crate, which follows the URL standard of the WHATWG).

use url::{Host, Url};

use crate::json::Style;
use crate::lines::{list, object, plain, text, EachLine, Members};
use crate::tree::Node;

fn null() -> Node {
    plain("null")
}

/// A part of a query read back: `+` is a space, and `%XX` the byte it stands for.
fn decoded(raw: &str) -> String {
    url::form_urlencoded::parse(format!("{raw}=").as_bytes()).next().map(|(name, _)| name.into_owned()).unwrap_or_default()
}

/// What is told of a URL written on a line.
pub fn told(line: &str) -> Result<Members, &'static str> {
    let url = Url::parse(line).map_err(|_| "bad-url")?;
    let (host, kind) = match url.host() {
        Some(Host::Domain(domain)) => (text(domain), "domain"),
        Some(Host::Ipv4(address)) => (text(&address.to_string()), "IPv4"),
        Some(Host::Ipv6(address)) => (text(&address.to_string()), "IPv6"),
        None => (null(), "none"),
    };
    let mut members: Members = vec![("href", text(url.as_str())), ("scheme", text(url.scheme()))];
    if !url.username().is_empty() {
        members.push(("username", text(url.username())));
    }
    if let Some(password) = url.password() {
        members.push(("password", text(password)));
    }
    members.push(("host", host));
    members.push(("hostKind", text(kind)));
    if let Some(Host::Domain(domain)) = url.host() {
        // A name written in the letters of its language is carried as Punycode: both are told.
        let (unicode, fine) = idna::domain_to_unicode(domain);
        if fine.is_ok() && unicode != domain {
            members.push(("hostUnicode", text(&unicode)));
        }
    }
    members.push(("port", url.port().map_or_else(null, plain)));
    // The port the scheme goes to when none is written.
    members.push(("portUsed", url.port_or_known_default().map_or_else(null, plain)));
    members.push(("origin", text(&url.origin().ascii_serialization())));
    members.push(("path", text(url.path())));
    if let Some(segments) = url.path_segments() {
        members.push(("segments", list(segments.map(text))));
    }
    members.push(("query", url.query().map_or_else(null, text)));
    if let Some(query) = url.query() {
        let parameters = query.split('&').filter(|part| !part.is_empty()).map(|part| {
            let (name, value) = part.split_once('=').unwrap_or((part, ""));
            object(vec![("name", text(&decoded(name))), ("value", text(&decoded(value))), ("raw", text(part))])
        });
        members.push(("parameters", list(parameters)));
    }
    members.push(("fragment", url.fragment().map_or_else(null, text)));
    Ok(members)
}

/// Each line told as a URL.
pub fn stage(style: Style) -> EachLine {
    EachLine::new(style, "urls-read", told)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::through;

    fn apart(url: &str) -> String {
        String::from_utf8(through(&mut stage(Style::Minify), url.as_bytes(), 7).expect("read")).expect("text")
    }

    #[test]
    fn a_url_is_taken_apart() {
        assert_eq!(
            apart("https://ana:s%20ecret@Example.com:8443/a%20b/c.html?q=caf%C3%A9+au+lait&empty=&flag&x=1&x=2#top"),
            r#"[{"href":"https://ana:s%20ecret@example.com:8443/a%20b/c.html?q=caf%C3%A9+au+lait&empty=&flag&x=1&x=2#top","scheme":"https","username":"ana","password":"s%20ecret","host":"example.com","hostKind":"domain","port":8443,"portUsed":8443,"origin":"https://example.com:8443","path":"/a%20b/c.html","segments":["a%20b","c.html"],"query":"q=caf%C3%A9+au+lait&empty=&flag&x=1&x=2","parameters":[{"name":"q","value":"café au lait","raw":"q=caf%C3%A9+au+lait"},{"name":"empty","value":"","raw":"empty="},{"name":"flag","value":"","raw":"flag"},{"name":"x","value":"1","raw":"x=1"},{"name":"x","value":"2","raw":"x=2"}],"fragment":"top"}]"#
        );
    }

    #[test]
    fn hosts_of_every_kind_and_the_ports_their_schemes_use() {
        assert!(apart("http://192.168.1.10/").contains(r#""host":"192.168.1.10","hostKind":"IPv4","port":null,"portUsed":80"#));
        assert!(apart("https://[2001:db8::1]:443/").contains(r#""host":"2001:db8::1","hostKind":"IPv6","port":null,"portUsed":443"#));
        assert!(apart("https://bücher.example/").contains(r#""host":"xn--bcher-kva.example","hostKind":"domain","hostUnicode":"bücher.example""#));
        assert!(apart("mailto:ana@example.com").contains(r#""host":null,"hostKind":"none","port":null,"portUsed":null,"origin":"null","path":"ana@example.com","query":null,"fragment":null"#));
        assert_eq!(told("not a url").err(), Some("bad-url"));
        assert_eq!(told("//example.com/no-scheme").err(), Some("bad-url"));
    }
}
