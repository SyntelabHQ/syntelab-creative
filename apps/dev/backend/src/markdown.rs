//! Markdown written as HTML, to be looked at and to be copied.
//!
//! CommonMark with what GitHub adds to it: tables, strikethrough, task lists, footnotes. What is written is safe to
//! show as it is: HTML typed inside the Markdown is shown as the text it is, not run; a link leads only to a web
//! address, a mail address or a place in the page; and a picture that would have to be fetched from the network is
//! not fetched (the program goes online only where the user points it): its words and its address are shown
//! instead. A picture carried in the text itself (`data:`) is shown.

use pulldown_cmark::{html, CowStr, Event, Options, Parser, Tag, TagEnd};

use crate::whole::Whole;

/// Where a link may lead: the web, a mail address, a place in the page, or a path beside it.
fn safe_link(address: &str) -> bool {
    let lower = address.trim().to_ascii_lowercase();
    match lower.split_once(':') {
        // No scheme: a place in the page, or a path.
        None => true,
        Some((scheme, _)) if scheme.contains(['/', '?', '#']) => true,
        Some((scheme, _)) => matches!(scheme, "http" | "https" | "mailto"),
    }
}

/// The Markdown as HTML, and what was counted on the way: headings, links, and pictures that were not fetched.
pub fn written(markdown: &str) -> (String, usize, usize, usize) {
    let options = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS | Options::ENABLE_FOOTNOTES;
    let (mut headings, mut links, mut left_out) = (0, 0, 0);
    // Pictures that are open, innermost last: whether each is shown, and the address of one that is not.
    let mut pictures: Vec<Option<String>> = Vec::new();
    let mut events: Vec<Event> = Vec::new();
    for event in Parser::new_ext(markdown, options) {
        match event {
            // HTML typed in the Markdown is shown as what was typed.
            Event::Html(raw) | Event::InlineHtml(raw) => events.push(Event::Text(raw)),
            Event::Start(Tag::Heading { .. }) => {
                headings += 1;
                events.push(event);
            }
            Event::Start(Tag::Link { link_type, dest_url, title, id }) => {
                links += 1;
                let dest_url = if safe_link(&dest_url) { dest_url } else { CowStr::Borrowed("") };
                events.push(Event::Start(Tag::Link { link_type, dest_url, title, id }));
            }
            Event::Start(Tag::Image { dest_url, .. }) if !dest_url.trim().to_ascii_lowercase().starts_with("data:image/") => {
                left_out += 1;
                pictures.push(Some(dest_url.to_string()));
                events.push(Event::Start(Tag::Emphasis));
            }
            Event::Start(Tag::Image { .. }) => {
                pictures.push(None);
                events.push(event);
            }
            Event::End(TagEnd::Image) => match pictures.pop() {
                Some(Some(address)) => {
                    events.push(Event::Text(CowStr::from(format!(" ({address})"))));
                    events.push(Event::End(TagEnd::Emphasis));
                }
                _ => events.push(event),
            },
            other => events.push(other),
        }
    }
    let mut written = String::new();
    html::push_html(&mut written, events.into_iter());
    (written, headings, links, left_out)
}

/// A stage that holds the Markdown it is given and writes it as HTML.
pub fn stage() -> Whole {
    Whole::new(|text, out| {
        let (written, headings, links, left_out) = written(text);
        out.write_all(written.as_bytes())?;
        let mut notes = vec![("markdown-read", format!("{headings}\n{links}"))];
        if left_out > 0 {
            notes.push(("markdown-pictures", left_out.to_string()));
        }
        Ok(notes)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn html_of(markdown: &str) -> String {
        written(markdown).0
    }

    #[test]
    fn writes_markdown_as_html() {
        assert_eq!(html_of("# Title\n\nSome *words* and `code`.\n"), "<h1>Title</h1>\n<p>Some <em>words</em> and <code>code</code>.</p>\n");
        let table = html_of("| a | b |\n|---|--:|\n| 1 | 2 |\n");
        assert!(table.contains("<table>") && table.contains("<td style=\"text-align: right\">2</td>"), "{table}");
        assert!(html_of("- [x] done\n- [ ] not yet\n").contains("<input disabled=\"\" type=\"checkbox\" checked=\"\"/>"));
        assert!(html_of("~~gone~~").contains("<del>gone</del>"));
        assert!(html_of("```rust\nfn main() {}\n```\n").contains("<pre><code class=\"language-rust\">fn main() {}\n</code></pre>"));
        assert_eq!((written("# a\n## b\n[x](https://example.com) [y](#b)").1, written("# a\n## b\n[x](https://example.com) [y](#b)").2), (2, 2));
    }

    #[test]
    fn shows_html_typed_in_it_as_text_and_runs_nothing() {
        let shown = html_of("Hello <script>alert(1)</script> <b onclick=\"x()\">bold</b>\n\n<div onload=\"x()\">block</div>\n");
        assert!(!shown.contains("<script") && !shown.contains("<b ") && !shown.contains("<div"), "{shown}");
        assert!(shown.contains("&lt;script&gt;alert(1)&lt;/script&gt;") && shown.contains("&lt;div onload=\"x()\"&gt;"), "{shown}");
        // A link that would run something leads nowhere; the others lead where they say.
        assert_eq!(html_of("[run](javascript:alert(1))"), "<p><a href=\"\">run</a></p>\n");
        assert_eq!(html_of("[run](JaVaScRiPt:alert(1))"), "<p><a href=\"\">run</a></p>\n");
        assert_eq!(html_of("[data](data:text/html,<script>x</script>)"), "<p><a href=\"\">data</a></p>\n");
        assert!(html_of("[a](https://example.com/x?y=1#z) [b](mailto:me@example.com) [c](#top) [d](other.md) [e](a/b:c)").matches("href=\"\"").count() == 0);
    }

    #[test]
    fn does_not_fetch_a_picture_from_the_network() {
        let (shown, _, _, left_out) = written("![a cat](https://example.com/cat.png \"title\") and ![dot](data:image/png;base64,AAAA)");
        assert_eq!(left_out, 1);
        assert!(shown.contains("<em>a cat (https://example.com/cat.png)</em>"), "{shown}");
        assert!(shown.contains("<img src=\"data:image/png;base64,AAAA\" alt=\"dot\" />"), "{shown}");
        assert!(!shown.contains("src=\"https://"));
        // A file beside the text is not read either.
        assert!(!html_of("![local](pictures/a.png)").contains("<img"));
    }
}
