//! Bounded inert HTML text extraction. This never runs a browser, scripts, CSS
//! or external resources. Semantically hidden nodes are omitted.
use chrono::{DateTime, NaiveDate};
use html5ever::tokenizer::{
    states::RawKind, BufferQueue, CharacterTokens, EndTag, StartTag, Tag, TagToken, Token,
    TokenSink, TokenSinkResult, Tokenizer, TokenizerOpts,
};
use std::cell::RefCell;

const MAX_DEPTH: usize = 160;
const MAX_BLOCKS: usize = 256;
const MAX_BLOCK_BYTES: usize = 16 * 1024;

pub(super) struct Page {
    pub title: String,
    pub published_at: Option<String>,
    pub blocks: Vec<String>,
}

#[derive(Default)]
struct Parser {
    stack: Vec<Element>,
    title: String,
    heading: String,
    publication: Option<String>,
    general: Vec<String>,
    primary: Vec<String>,
    current: String,
    current_primary: bool,
    block_overflow: bool,
    rejected: bool,
}
struct Element {
    name: html5ever::LocalName,
    hidden: bool,
}

fn matches_tag(tag: &Tag, names: &[&str]) -> bool {
    names.contains(&tag.name.as_ref())
}

fn attribute<'a>(tag: &'a Tag, name: &str) -> Option<&'a str> {
    tag.attrs
        .iter()
        .find(|attribute| attribute.name.local.as_ref() == name)
        .map(|attribute| attribute.value.as_ref())
}

fn date(value: &str) -> Option<String> {
    if value.len() > 50 {
        return None;
    }
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.to_rfc3339())
        .ok()
        .or_else(|| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .ok()
                .map(|d| d.to_string())
        })
}

fn safe_text(text: &str) -> String {
    text.chars()
        .filter(|&c| {
            !matches!(c, '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
                && (!c.is_control() || c.is_whitespace())
        })
        .collect()
}

pub(super) fn excludes_snippet(value: &str) -> bool {
    value
        .split(|c: char| matches!(c, ',' | ':' | ';') || c.is_whitespace())
        .any(|flag| {
            ["nosnippet", "noai", "noarchive"]
                .iter()
                .any(|entry| flag.eq_ignore_ascii_case(entry))
        })
}

fn normalize(text: &str) -> String {
    safe_text(text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

impl Parser {
    fn in_tag(&self, tag: &str) -> bool {
        self.stack.iter().any(|node| node.name.as_ref() == tag)
    }

    fn hidden(&self) -> bool {
        self.stack.iter().any(|node| node.hidden)
    }

    fn in_primary(&self) -> bool {
        self.in_tag("article") || self.in_tag("main")
    }

    fn start(&mut self, tag: Tag) -> TokenSinkResult<()> {
        let name = tag.name.as_ref();
        let mode = match name {
            "script" => Some(RawKind::ScriptData),
            "title" | "textarea" => Some(RawKind::Rcdata),
            "style" | "iframe" | "xmp" | "noembed" | "noframes" => Some(RawKind::Rawtext),
            _ => None,
        };
        if name == "plaintext" {
            self.rejected = true;
            return TokenSinkResult::Plaintext;
        }
        if name == "meta" && !self.in_tag("body") {
            if attribute(&tag, "name").is_some_and(|value| {
                ["robots", "googlebot"]
                    .iter()
                    .any(|name| value.eq_ignore_ascii_case(name))
            }) && attribute(&tag, "content").is_some_and(excludes_snippet)
            {
                self.rejected = true;
            }
            if self.publication.is_none()
                && (attribute(&tag, "property") == Some("article:published_time")
                    || attribute(&tag, "itemprop") == Some("datePublished"))
            {
                self.publication = attribute(&tag, "content").and_then(date);
            }
        }
        if name == "time"
            && !self.hidden()
            && self.publication.is_none()
            && attribute(&tag, "itemprop") == Some("datePublished")
        {
            self.publication = attribute(&tag, "datetime").and_then(date);
        }
        let table = self.in_tag("table");
        if table && matches_tag(&tag, &["th", "td"]) {
            self.push(" | ");
        }
        if table && name == "tr" {
            self.push("\n");
        }
        if !table && boundary(name) {
            self.flush();
            if name == "table" && !self.heading.is_empty() {
                let heading = self.heading.clone();
                self.push(&heading);
            }
        }
        if name == "br" {
            self.push("\n");
        }
        if !matches_tag(
            &tag,
            &[
                "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
                "param", "source", "track", "wbr",
            ],
        ) {
            // Close consecutive list/paragraph elements whose end tags are optional.
            if matches!(name, "p" | "li" | "dt" | "dd" | "th" | "td" | "tr")
                && self.stack.last().is_some_and(|node| node.name == tag.name)
            {
                self.stack.pop();
            }
            if self.stack.len() >= MAX_DEPTH {
                self.rejected = true;
            } else {
                let hidden = matches_tag(
                    &tag,
                    &[
                        "script", "style", "template", "noscript", "nav", "aside", "footer",
                        "form", "button", "textarea", "select", "iframe", "svg", "canvas", "xmp",
                        "noembed", "noframes",
                    ],
                ) || (name == "header" && !self.in_primary())
                    || attribute(&tag, "hidden").is_some()
                    || attribute(&tag, "aria-hidden")
                        .is_some_and(|value| value.eq_ignore_ascii_case("true"))
                    || attribute(&tag, "style").is_some_and(|style| {
                        let compact = style
                            .to_ascii_lowercase()
                            .replace(|c: char| c.is_whitespace(), "");
                        compact.contains("display:none") || compact.contains("visibility:hidden")
                    });
                self.stack.push(Element {
                    name: tag.name,
                    hidden,
                });
            }
        }
        mode.map_or(TokenSinkResult::Continue, TokenSinkResult::RawData)
    }

    fn close(&mut self, tag: Tag) {
        let name = tag.name.as_ref();
        if let Some(index) = self.stack.iter().rposition(|node| node.name == tag.name) {
            if !self.in_tag("table") && heading(name) && !self.hidden() {
                self.heading = normalize(&self.current).chars().take(160).collect();
            }
            if name == "table" || (!self.in_tag("table") && boundary(name)) {
                self.flush();
            }
            self.stack.truncate(index);
        }
    }

    fn push(&mut self, text: &str) {
        if self.block_overflow {
            return;
        }
        if self.current.len() + text.len() > MAX_BLOCK_BYTES {
            // Drop the entire block, keeping its qualifiers and table structure intact.
            self.block_overflow = true;
            return;
        }
        self.current_primary |= self.in_primary();
        self.current.push_str(text);
    }

    fn flush(&mut self) {
        let text = std::mem::take(&mut self.current);
        let overflow = std::mem::take(&mut self.block_overflow);
        let primary = std::mem::take(&mut self.current_primary);
        if overflow || text.is_empty() || self.general.len() >= MAX_BLOCKS {
            return;
        }
        let text = text
            .lines()
            .map(normalize)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            if primary {
                self.primary.push(text.clone());
            }
            self.general.push(text);
        }
    }
}

fn heading(name: &str) -> bool {
    matches!(name, "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
}

fn boundary(name: &str) -> bool {
    matches!(
        name,
        "main"
            | "article"
            | "section"
            | "p"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "li"
            | "dt"
            | "dd"
            | "blockquote"
            | "pre"
            | "table"
            | "div"
            | "hr"
    )
}

struct Sink(RefCell<Parser>);
impl TokenSink for Sink {
    type Handle = ();

    fn process_token(&self, token: Token, _: u64) -> TokenSinkResult<()> {
        let mut parser = self.0.borrow_mut();
        if parser.rejected {
            return TokenSinkResult::Continue;
        }
        match token {
            TagToken(tag) if tag.kind == StartTag => return parser.start(tag),
            TagToken(tag) if tag.kind == EndTag => parser.close(tag),
            CharacterTokens(text) if parser.in_tag("title") && !parser.hidden() => {
                if parser.title.len() < 800 {
                    parser
                        .title
                        .push_str(&text.chars().take(240).collect::<String>());
                }
            }
            CharacterTokens(text) if !parser.in_tag("head") && !parser.hidden() => {
                parser.push(&text);
            }
            _ => {}
        }
        TokenSinkResult::Continue
    }
}

pub(super) fn extract(text: &str) -> Option<Page> {
    let tokenizer = Tokenizer::new(
        Sink(RefCell::new(Parser::default())),
        TokenizerOpts::default(),
    );
    let input = BufferQueue::default();
    input.push_back(text.into());
    let _ = tokenizer.feed(&input);
    tokenizer.end();
    let mut parser = tokenizer.sink.0.into_inner();
    if parser.rejected {
        return None;
    }
    parser.flush();
    let title: String = normalize(&parser.title).chars().take(180).collect();
    let lower = title.to_ascii_lowercase();
    if [
        "just a moment",
        "access denied",
        "robot check",
        "verify you are human",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase))
    {
        return None;
    }
    let blocks = if parser.primary.iter().map(|s| s.len()).sum::<usize>() >= 120 {
        parser.primary
    } else {
        parser.general
    };
    Some(Page {
        title,
        published_at: parser.publication,
        blocks,
    })
}

pub(super) fn plain(text: &str) -> Page {
    let blocks = text
        .split("\n\n")
        .filter(|p| p.len() <= MAX_BLOCK_BYTES)
        .map(normalize)
        .filter(|p| !p.is_empty())
        .take(MAX_BLOCKS)
        .collect();
    Page {
        title: String::new(),
        published_at: None,
        blocks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extraction_is_inert_and_keeps_publication_and_complete_table() {
        let html = r#"<html><head><title>Release &amp; policies</title>
          <meta property="article:published_time" content="2026-05-02">
          <script>var ignored = '<article>BOGUS</article>';</script>
          </head><body><nav>ignore menu</nav><article><h1>Version policy</h1>
          <div hidden>ignore hidden</div><p>The rule applies to all published packages and does not apply to internal staging tools or preview builds.</p>
          <style>/* ignore style */</style>
          <table><tr><th>Version</th><th>Requirements</th></tr><tr><td>2.0</td><td>Linux only</td></tr></table>
          <template><p>ignore template</p></template></article></body></html>"#;
        let page = extract(html).unwrap();
        assert_eq!(page.title, "Release & policies");
        assert_eq!(page.published_at.as_deref(), Some("2026-05-02"));
        let body = page.blocks.join("\n\n");
        assert!(body.contains("does not apply"));
        assert!(page
            .blocks
            .iter()
            .any(|b| b.contains("Version | Requirements") && b.contains("2.0 | Linux only")));
        assert!(!body.contains("ignore"));
        assert!(!body.contains("BOGUS"));
    }

    #[test]
    fn disallowed_preview_and_interstitial_are_ignored() {
        assert!(extract("<meta name='robots' content='noindex,nosnippet'><p>page</p>").is_none());
        assert!(extract("<title>Just a moment...</title><p>interstitial</p>").is_none());
        assert!(extract(&"<div>".repeat(MAX_DEPTH + 1)).is_none());
    }
}
