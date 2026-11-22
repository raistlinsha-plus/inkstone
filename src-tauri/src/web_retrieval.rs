//! Explicitly enabled public web discovery and direct, read-only page retrieval.
//! Brave response snippets are deliberately neither read nor persisted.
#[path = "web_retrieval/html.rs"]
mod html;

use crate::{files, AppState};
use chrono::Utc;
use futures_util::{stream, StreamExt};
use reqwest::{header, Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::State;

pub(crate) const ENDPOINT: &str = "https://api.search.brave.com/res/v1/web/search";
pub(crate) const KEY_KIND: &str = "web-brave";
const SEARCH_RESULTS: usize = 10;
const MAX_PAGES: usize = 4;
const MAX_SEARCH_BYTES: usize = 384 * 1024;
const MAX_SEARCH_ERROR_BYTES: usize = 8 * 1024;
const MAX_PAGE_BYTES: usize = 768 * 1024;
const MAX_EXCERPT_CHARS: usize = 2400;
const WEB_TIMEOUT: Duration = Duration::from_secs(8);
const DIAGNOSTIC_QUERY: &str = "Rust programming language documentation";
const DIAGNOSTIC_PAGE_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct Config {
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSettingsView {
    enabled: bool,
    has_key: bool,
    provider: &'static str,
}

fn config_path(state: &AppState) -> PathBuf {
    state.config_file.with_file_name("web-search.json")
}

fn config(state: &AppState) -> Result<Config, String> {
    match std::fs::read(config_path(state)) {
        Ok(raw) => serde_json::from_slice(&raw).map_err(|_| "联网搜索设置无法读取".into()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(Config::default()),
        Err(_) => Err("联网搜索设置无法读取".into()),
    }
}

pub(crate) fn is_enabled(state: &AppState) -> bool {
    config(state).is_ok_and(|value| value.enabled)
}

fn settings_view(state: &AppState) -> Result<WebSettingsView, String> {
    Ok(WebSettingsView {
        enabled: config(state)?.enabled,
        has_key: crate::has_local_key(state, KEY_KIND, ENDPOINT)?,
        provider: "brave",
    })
}

#[tauri::command]
pub fn web_search_settings(state: State<'_, AppState>) -> Result<WebSettingsView, String> {
    settings_view(&state)
}

#[tauri::command]
pub async fn save_web_search_settings(
    app: tauri::AppHandle,
    enabled: bool,
    api_key: Option<String>,
    clear_key: Option<bool>,
) -> Result<WebSettingsView, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _write = state
            .settings_write
            .lock()
            .map_err(|_| "联网搜索设置保存状态不可用")?;
        let key = api_key.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let clear = clear_key.unwrap_or(false);
        if clear && (key.is_some() || enabled) {
            return Err("删除搜索密钥时请同时关闭联网搜索，并清空新密钥输入".into());
        }
        if let Some(value) = key {
            validate_key(value)?;
        }
        if enabled && key.is_none() && !crate::has_local_key(&state, KEY_KIND, ENDPOINT)? {
            return Err("启用前请填写 Brave Search API 密钥".into());
        }
        if clear || key.is_some() {
            crate::check_idle(&state)?;
            state.credentials.invalidate();
            crate::local_credentials::save(&state.data_dir, KEY_KIND, ENDPOINT, key, clear)?;
        }
        files::write_atomic(
            &config_path(&state),
            &serde_json::to_vec(&Config { enabled }).map_err(|e| e.to_string())?,
        )?;
        settings_view(&state)
    })
    .await
    .map_err(|_| "保存联网搜索设置失败".to_string())?
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum DiagnosticStatus {
    Ok,
    MissingKey,
    InvalidKey,
    Keychain,
    Timeout,
    Connection,
    Unauthorized,
    Forbidden,
    RateLimited,
    ProviderError,
    UnexpectedStatus,
    InvalidResponse,
    NoCandidates,
    PageUnreadable,
    Unavailable,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BraveDiagnostic {
    status: DiagnosticStatus,
    search_elapsed_ms: Option<u64>,
    page_elapsed_ms: Option<u64>,
    candidate_count: Option<usize>,
    http_status: Option<u16>,
}

impl BraveDiagnostic {
    fn new(status: DiagnosticStatus) -> Self {
        Self {
            status,
            search_elapsed_ms: None,
            page_elapsed_ms: None,
            candidate_count: None,
            http_status: None,
        }
    }
}

#[tauri::command]
pub async fn test_web_search_connection(
    app: tauri::AppHandle,
    api_key: Option<String>,
) -> BraveDiagnostic {
    use tauri::Manager;
    if cfg!(feature = "desktop-e2e") {
        return BraveDiagnostic::new(DiagnosticStatus::Unavailable);
    }
    let cancel = AtomicBool::new(false);
    let key = match api_key.filter(|value| !value.trim().is_empty()) {
        Some(value) => value,
        None => {
            match crate::read_key(&app.state::<AppState>(), KEY_KIND, ENDPOINT, &cancel).await {
                Ok(Some(value)) => value,
                Ok(None) => return BraveDiagnostic::new(DiagnosticStatus::MissingKey),
                Err(_) => return BraveDiagnostic::new(DiagnosticStatus::Keychain),
            }
        }
    };
    run_diagnostic(key.trim()).await
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
}

async fn run_diagnostic(key: &str) -> BraveDiagnostic {
    if validate_key(key).is_err() {
        return BraveDiagnostic::new(DiagnosticStatus::InvalidKey);
    }
    let Ok(client) = BraveClient::new() else {
        return BraveDiagnostic::new(DiagnosticStatus::Unavailable);
    };
    let started = Instant::now();
    let result = client.candidates(DIAGNOSTIC_QUERY, key).await;
    let search_elapsed_ms = Some(elapsed_ms(started));
    let urls = match result {
        Ok((_, urls)) => urls,
        Err(error) => {
            return BraveDiagnostic {
                search_elapsed_ms,
                http_status: error.http_status.map(|status| status.as_u16()),
                ..BraveDiagnostic::new(error.status)
            };
        }
    };
    let mut report = BraveDiagnostic {
        search_elapsed_ms,
        candidate_count: Some(urls.len()),
        http_status: Some(StatusCode::OK.as_u16()),
        ..BraveDiagnostic::new(DiagnosticStatus::NoCandidates)
    };
    if !urls.is_empty() {
        let started = Instant::now();
        let Ok(client) = public_page_client() else {
            report.status = DiagnosticStatus::Unavailable;
            return report;
        };
        let terms = query_terms(DIAGNOSTIC_QUERY);
        let pages = stream::iter(urls)
            .map(|url| fetch_page(&client, url, &terms))
            .buffer_unordered(MAX_PAGES)
            .filter_map(std::future::ready);
        let page = tokio::time::timeout(DIAGNOSTIC_PAGE_TIMEOUT, async {
            futures_util::pin_mut!(pages);
            pages.next().await
        })
        .await;
        report.page_elapsed_ms = Some(elapsed_ms(started));
        report.status = match page {
            Ok(Some(_)) => DiagnosticStatus::Ok,
            _ => DiagnosticStatus::PageUnreadable,
        };
    }
    report
}

fn validate_key(value: &str) -> Result<(), String> {
    if !(8..=512).contains(&value.len()) || !value.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("Brave Search API 密钥格式无效".into());
    }
    Ok(())
}

/// This value cannot be constructed outside the question-only outbound gate.
pub(crate) struct PublicQuery(String);

/// Only explicitly typed current-turn terms (and a small neutral vocabulary)
/// are eligible. This gate accepts neither source context nor arbitrary URLs.
pub(crate) fn safe_query(question: &str, proposed: &str) -> Result<PublicQuery, String> {
    let denied = "未找到可安全发送的公开查询词，本轮保留可用的本地结果";
    if explicitly_offline(question)
        || sensitive(question)
        || sensitive(proposed)
        || private_work(question)
    {
        return Err(denied.into());
    }
    let words: Vec<&str> = proposed.split_whitespace().collect();
    if words.is_empty()
        || words.len() > 20
        || proposed.chars().count() > 180
        || !proposed.chars().all(|c| {
            c.is_alphanumeric() || c.is_whitespace() || matches!(c, '-' | '–' | '+' | '.' | '·')
        })
        || words
            .iter()
            .any(|word| !word.chars().any(char::is_alphanumeric))
    {
        return Err(denied.into());
    }
    let question = question.to_lowercase();
    let neutral = [
        "latest",
        "official",
        "update",
        "updates",
        "news",
        "documentation",
        "release",
        "releases",
        "requirements",
        "current",
        "version",
        "guide",
        "官网",
        "官方",
        "最新",
        "更新",
        "发布",
        "版本",
        "规定",
        "要求",
        "指南",
        "说明",
        "公告",
        "查询",
    ];
    let mut specific = false;
    for word in &words {
        let word = word.to_lowercase();
        if neutral.contains(&word.as_str()) {
            continue;
        }
        if !appears_in_question(&question, &word) {
            return Err(denied.into());
        }
        specific |= word.chars().filter(|c| c.is_alphabetic()).count() >= 2;
    }
    if !specific {
        return Err(denied.into());
    }
    Ok(PublicQuery(words.join(" ")))
}

pub(crate) fn explicitly_offline(question: &str) -> bool {
    let q = question
        .to_lowercase()
        .replace(['\u{2018}', '\u{2019}'], "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let no_web = [
        "别联网",
        "不联网",
        "不要联网",
        "无需联网",
        "禁止联网",
        "不能联网",
        "不要联网搜索",
        "不要访问互联网",
        "禁止访问互联网",
        "不要使用互联网",
        "不要搜索互联网",
        "不使用互联网",
        "不要访问外部网站",
        "禁止访问外部网站",
        "请勿访问外部网站",
        "不允许访问外部网站",
        "不要使用外部网站",
        "不访问外部网站",
        "别访问外部网站",
        "不要访问任何网站",
        "不要查外网",
        "不访问外网",
        "别查外网",
        "禁止外发",
        "不要外发",
        "不查网页",
        "别查网页",
        "不要查网页",
        "不要搜索网页",
        "别搜索网页",
        "别搜网页",
        "不要用搜索",
        "不使用搜索",
        "离线回答",
        "无需上网",
        "不要上网",
        "别上网",
        "不上网",
        "关闭联网",
        "关掉联网",
        "no web",
        "no internet",
        "no external websites",
        "without external websites",
        "do not access external websites",
        "don't access external websites",
        "do not use external websites",
        "don't use external websites",
        "without web access",
        "without internet",
        "without browsing",
        "without going online",
        "do not go online",
        "don't go online",
        "do not access the internet",
        "don't access the internet",
        "do not use the web",
        "don't use the web",
        "do not use the internet",
        "don't use the internet",
        "don't search",
        "do not search",
        "do not browse",
        "don't browse",
        "offline only",
        "local only",
        "work offline",
        "answer offline",
    ]
    .iter()
    .any(|needle| q.contains(needle));

    // "Only the supplied documents" is a local restriction, while "only
    // Python's official website" explicitly describes a public source.
    let only_local_chinese = ["只", "仅", "只允许", "仅允许"].iter().any(|only| {
        q.match_indices(only).any(|(at, _)| {
            if q[..at].ends_with('不') {
                return false;
            }
            let after = q[at + only.len()..].trim_start();
            [
                "使用", "依照", "依据", "根据", "基于", "参考", "限于", "限", "用", "看", "按",
            ]
            .iter()
            .filter_map(|verb| after.strip_prefix(verb))
            .any(|object| {
                let object = object.trim_start();
                [
                    "本地",
                    "附件",
                    "所选",
                    "选中",
                    "已选",
                    "这份",
                    "这两份",
                    "这几份",
                    "这些",
                    "此处",
                    "本文",
                    "原文",
                    "提供的",
                    "给出的",
                    "给你的",
                    "上传",
                    "以下",
                    "下列",
                    "上述",
                    "手头",
                    "当前文档",
                    "当前空间",
                    "公司内部",
                    "我发的",
                    "我的资料",
                    "我的笔记",
                    "我的文档",
                    "我提供的",
                ]
                .iter()
                .any(|target| object.starts_with(target))
            })
        })
    });
    let only_local_english = [
        "use only ",
        "only use ",
        "based only on ",
        "only based on ",
        "only ",
    ]
    .iter()
    .any(|prefix| {
        q.match_indices(prefix).any(|(at, _)| {
            if q[..at].ends_with("not ") {
                return false;
            }
            let object = q[at + prefix.len()..].trim_start_matches("the ");
            [
                "selected ",
                "attached ",
                "uploaded ",
                "provided ",
                "supplied ",
                "given ",
                "local ",
                "internal ",
                "these documents",
                "this document",
                "this text",
            ]
            .iter()
            .any(|target| object.starts_with(target))
        })
    });
    no_web || only_local_chinese || only_local_english
}

fn private_work(question: &str) -> bool {
    let q = question.to_lowercase();
    [
        "我的客户",
        "我们的客户",
        "客户资料",
        "客户隐私",
        "内部项目",
        "my client",
        "our client",
        "client records",
        "internal project",
    ]
    .iter()
    .any(|term| q.contains(term))
        || (q.contains("客户")
            && ["梳理", "跟进", "整理", "交付"]
                .iter()
                .any(|term| q.contains(term))
            && ["项目", "会议", "文件", "记录"]
                .iter()
                .any(|term| q.contains(term)))
}

fn appears_in_question(question: &str, word: &str) -> bool {
    if !word.is_ascii() {
        return question.contains(word);
    }
    // ASCII tokens must not be newly extracted from larger words/identifiers.
    let part = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '+');
    question.match_indices(word).any(|(start, _)| {
        // A period joins a version or hostname only when text continues
        // immediately beyond it. Sentence-ending punctuation is a boundary.
        !question[..start]
            .trim_end_matches('.')
            .chars()
            .next_back()
            .is_some_and(part)
            && !question[start + word.len()..]
                .trim_start_matches('.')
                .chars()
                .next()
                .is_some_and(part)
    })
}

fn sensitive(text: &str) -> bool {
    let q = text.to_lowercase();
    if [
        "://",
        "@",
        "/users/",
        "/home/",
        "/etc/",
        "file:",
        "sk-",
        "ghp_",
        "github_pat_",
        "api_key",
        "apikey",
        "api key",
        "access token",
        "bearer ",
        "密钥",
        "密码",
        "身份证",
        "手机号",
        "银行卡",
        "工号",
        "客户名单",
        "内部编号",
        "内部代号",
        "保密",
        "confidential",
        "private key",
        "password",
        "secret token",
    ]
    .iter()
    .any(|needle| q.contains(needle))
    {
        return true;
    }
    // Compact telephone/identifier forms and high-entropy-looking tokens.
    let long_numbers = q
        .split(|c: char| !(c.is_ascii_digit() || c == '-' || c == ' '))
        .any(|part| part.bytes().filter(u8::is_ascii_digit).count() >= 11);
    long_numbers
        || q.split(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
            .any(|part| {
                part.len() >= 20
                    && part.bytes().any(|b| b.is_ascii_digit())
                    && part.bytes().any(|b| b.is_ascii_alphabetic())
            })
}

/// Metadata from the fetched publisher page only. Safe to retain without
/// persisting the search provider response or the fetched excerpt.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WebSource {
    pub url: String,
    pub title: String,
    pub domain: String,
    pub fetched_at: String,
    pub published_at: Option<String>,
    pub content_hash: String,
}

pub(crate) struct WebEvidence {
    pub metadata: WebSource,
    pub text: String,
}

pub(crate) struct WebResults {
    pub evidence: Vec<WebEvidence>,
    pub searched: usize,
    pub discarded: usize,
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(rename = "type")]
    kind: Option<String>,
    web: Option<WebBlock>,
}
#[derive(Deserialize)]
struct WebBlock {
    results: Vec<BraveHit>,
}
#[derive(Deserialize)]
struct BraveHit {
    #[serde(default)]
    url: String,
}

fn public_host(host: &str) -> bool {
    let host = host.trim_end_matches('.');
    host.contains('.')
        && host.parse::<IpAddr>().is_err()
        && ![
            "localhost",
            "local",
            "home",
            "lan",
            "internal",
            "test",
            "invalid",
            "example",
            "onion",
            "home.arpa",
        ]
        .iter()
        .any(|suffix| {
            host == *suffix
                || host
                    .strip_suffix(suffix)
                    .is_some_and(|prefix| prefix.ends_with('.'))
        })
}

fn safe_page_url(raw: &str) -> Option<Url> {
    if raw.len() > 2048 || raw.chars().any(char::is_control) {
        return None;
    }
    let mut url = Url::parse(raw).ok()?;
    if url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || !url.host_str().is_some_and(public_host)
    {
        return None;
    }
    let mut pairs = vec![];
    for (key, value) in url.query_pairs() {
        let lower = key.to_ascii_lowercase();
        if [
            "token",
            "key",
            "auth",
            "password",
            "secret",
            "session",
            "signature",
            "signed",
        ]
        .iter()
        .any(|needle| lower.contains(needle))
        {
            return None;
        }
        if !lower.starts_with("utm_")
            && !matches!(lower.as_str(), "fbclid" | "gclid" | "msclkid" | "mc_eid")
        {
            pairs.push((key.into_owned(), value.into_owned()));
        }
    }
    url.set_fragment(None);
    url.set_query(None);
    if !pairs.is_empty() {
        url.query_pairs_mut().extend_pairs(pairs);
    }
    Some(url)
}

pub(crate) fn valid_source_url(value: &str) -> bool {
    safe_page_url(value).is_some_and(|safe| safe.as_str() == value)
}

fn globally_routable_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_documentation()
        || matches!(a, 0 | 224..=255)
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 88 && c == 99)
        || (a == 198 && matches!(b, 18 | 19)))
}

fn globally_routable_v6(ip: Ipv6Addr) -> bool {
    let [a, b, ..] = ip.segments();
    // Accept current public global-unicast allocations; reject protocol and
    // documentation ranges, mapped/NAT64 addresses and tunnelling prefixes.
    (0x2000..=0x3fff).contains(&a)
        && a != 0x2002
        && (a != 0x2001 || (b >= 0x0200 && b != 0x0db8))
        && a != 0x3fff
}

fn globally_routable(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => globally_routable_v4(ip),
        IpAddr::V6(ip) => globally_routable_v6(ip),
    }
}

/// reqwest consumes these exact socket addresses for its TLS connection, while
/// TLS still validates the original hostname. No second unchecked DNS lookup.
struct PublicResolver;
impl reqwest::dns::Resolve for PublicResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async move {
            let name = name.as_str();
            if !public_host(name) {
                return Err(io::Error::other("non-public host").into());
            }
            let addresses: Vec<_> = tokio::net::lookup_host((name, 443)).await?.collect();
            if addresses.is_empty() || addresses.iter().any(|addr| !globally_routable(addr.ip())) {
                return Err(io::Error::other("non-public DNS answer").into());
            }
            Ok(Box::new(addresses.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

fn bounded_https_client() -> reqwest::ClientBuilder {
    Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .http1_only()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .pool_max_idle_per_host(0)
        .user_agent(concat!(
            "Inkstone/",
            env!("CARGO_PKG_VERSION"),
            " (+local desktop public web retrieval)"
        ))
}

/// URLs from search results are untrusted: never send them through a proxy
/// that can resolve them on our behalf. Check DNS and the peer independently.
fn public_page_client() -> Result<Client, String> {
    bounded_https_client()
        .no_proxy()
        .dns_resolver(Arc::new(PublicResolver))
        .build()
        .map_err(|_| "无法初始化安全网页读取客户端".into())
}

enum BodyReadError {
    TooLarge,
    Timeout,
    Interrupted,
}

async fn limited_body(response: reqwest::Response, limit: usize) -> Result<Vec<u8>, BodyReadError> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(BodyReadError::TooLarge);
    }
    let mut body = Vec::new();
    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.map_err(|error| {
            if error.is_timeout() {
                BodyReadError::Timeout
            } else {
                BodyReadError::Interrupted
            }
        })?;
        if chunk.len() > limit - body.len() {
            return Err(BodyReadError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn identity_encoding(response: &reqwest::Response) -> bool {
    response
        .headers()
        .get_all(header::CONTENT_ENCODING)
        .iter()
        .all(|value| {
            value
                .to_str()
                .is_ok_and(|encoding| encoding.trim().eq_ignore_ascii_case("identity"))
        })
}

fn response_is_public(response: &reqwest::Response) -> bool {
    response
        .remote_addr()
        .is_some_and(|address| globally_routable(address.ip()))
}

fn parse_hits(bytes: &[u8]) -> Option<(usize, Vec<Url>)> {
    let payload: SearchResponse = serde_json::from_slice(bytes).ok()?;
    if payload.kind.as_deref().is_some_and(|kind| kind != "search")
        || (payload.kind.is_none() && payload.web.is_none())
    {
        return None;
    }
    let hits = payload.web.map_or_else(Vec::new, |block| block.results);
    let count = hits.len().min(SEARCH_RESULTS);
    let mut seen = HashSet::new();
    let mut hosts = HashMap::new();
    let urls = hits
        .into_iter()
        .take(SEARCH_RESULTS)
        .filter_map(|hit| safe_page_url(&hit.url))
        .filter(|url| seen.insert(url.clone()))
        .filter(|url| {
            let host = url
                .host_str()
                .unwrap_or_default()
                .trim_start_matches("www.");
            let count = hosts.entry(host.to_owned()).or_insert(0);
            *count += 1;
            *count <= 2
        })
        .take(MAX_PAGES)
        .collect();
    Some((count, urls))
}

fn safe_to_dispatch(state: &AppState, cancel: &AtomicBool) -> bool {
    !cancel.load(Ordering::SeqCst) && is_enabled(state)
}

async fn fetch_page(client: &Client, url: Url, terms: &[String]) -> Option<WebEvidence> {
    let receipt = crate::request_receipt::begin(crate::request_receipt::Service::WebPage, 0);
    let response = client
        .get(url.clone())
        .header(header::ACCEPT, "text/html,text/plain")
        .send()
        .await
        .ok()?;
    if let Some(h) = receipt {
        h.status(response.status().as_u16());
    }
    if response.status() != StatusCode::OK
        || !response_is_public(&response)
        || !identity_encoding(&response)
        || response
            .headers()
            .get_all("x-robots-tag")
            .iter()
            .any(|value| value.to_str().is_ok_and(html::excludes_snippet))
    {
        return None;
    }
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)?
        .to_str()
        .ok()?
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase();
    if !matches!(content_type.as_str(), "text/html" | "text/plain") {
        return None;
    }
    let body = limited_body(response, MAX_PAGE_BYTES).await.ok()?;
    let input = std::str::from_utf8(&body)
        .ok()?
        .trim_start_matches('\u{feff}');
    let page = if content_type == "text/html" {
        html::extract(input)?
    } else {
        html::plain(input)
    };
    let domain = url.host_str()?.to_string();
    let title = if page.title.is_empty() {
        domain.clone()
    } else {
        page.title
    };
    let content_hash = files::hash(page.blocks.join("\n\n"));
    let text = excerpt(&page.blocks, terms);
    if text.chars().count() < 30 {
        return None;
    }
    Some(WebEvidence {
        metadata: WebSource {
            url: url.into(),
            title,
            domain,
            fetched_at: chrono::DateTime::<Utc>::from(std::time::SystemTime::now()).to_rfc3339(),
            published_at: page.published_at,
            content_hash,
        },
        text,
    })
}

fn excerpt(blocks: &[String], terms: &[String]) -> String {
    let mut ranked: Vec<_> = blocks
        .iter()
        .enumerate()
        .filter_map(|(idx, block)| {
            let chars = block.chars().count();
            let lowered = block.to_lowercase();
            let score = terms
                .iter()
                .filter(|term| term.chars().count() > 1 && lowered.contains(term.as_str()))
                .count();
            (chars <= MAX_EXCERPT_CHARS).then_some((idx, chars, score))
        })
        .collect();
    ranked.sort_by_key(|(idx, _, score)| (std::cmp::Reverse(*score), *idx));
    let mut remaining = MAX_EXCERPT_CHARS;
    let mut indices = vec![];
    for (idx, chars, score) in ranked {
        if score == 0 {
            break;
        }
        if remaining >= chars + 2 {
            remaining -= chars + 2;
            indices.push(idx);
        }
    }
    indices.sort_unstable();
    indices
        .into_iter()
        .map(|idx| blocks[idx].as_str())
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[derive(Debug)]
struct SearchFailure {
    status: DiagnosticStatus,
    http_status: Option<StatusCode>,
}

impl SearchFailure {
    fn new(status: DiagnosticStatus, http_status: Option<StatusCode>) -> Self {
        Self {
            status,
            http_status,
        }
    }

    fn from_http(status: StatusCode) -> Self {
        let kind = match status {
            StatusCode::UNAUTHORIZED => DiagnosticStatus::Unauthorized,
            StatusCode::FORBIDDEN => DiagnosticStatus::Forbidden,
            StatusCode::TOO_MANY_REQUESTS => DiagnosticStatus::RateLimited,
            status if status.is_server_error() => DiagnosticStatus::ProviderError,
            _ => DiagnosticStatus::UnexpectedStatus,
        };
        Self::new(kind, Some(status))
    }

    fn warning(&self) -> String {
        match self.status {
            DiagnosticStatus::InvalidKey => "Brave Search API 密钥格式无效。",
            DiagnosticStatus::Timeout => "Brave Search 请求超时。",
            DiagnosticStatus::Connection => "无法完成 Brave Search 连接，请检查网络后重试。",
            DiagnosticStatus::Unauthorized => "Brave Search 未接受密钥，请检查自动联网设置。",
            DiagnosticStatus::Forbidden => "Brave Search 拒绝访问，请检查密钥权限和订阅。",
            DiagnosticStatus::RateLimited => "Brave Search 额度或速率受限，请稍后再试。",
            DiagnosticStatus::ProviderError => "Brave Search 服务暂不可用，请稍后再试。",
            DiagnosticStatus::InvalidResponse => "Brave Search 返回了无法处理的响应。",
            _ => "Brave Search 暂不可用。",
        }
        .into()
    }
}

/// Only the fixed Brave origin may use normal OS/HTTP proxy settings. TLS
/// still authenticates the hardcoded hostname inside CONNECT, while HTTPS
/// redirects are never followed. Do not expose this client to page fetching.
struct BraveClient(Client);

impl BraveClient {
    fn new() -> Result<Self, String> {
        bounded_https_client()
            .build()
            .map(Self)
            .map_err(|_| "无法初始化 Brave Search 客户端".into())
    }

    fn request(&self, query: &str, key: &str) -> Result<reqwest::RequestBuilder, SearchFailure> {
        let mut token = header::HeaderValue::from_str(key)
            .map_err(|_| SearchFailure::new(DiagnosticStatus::InvalidKey, None))?;
        token.set_sensitive(true);
        let search_lang = if query
            .chars()
            .any(|c| ('\u{3400}'..='\u{9fff}').contains(&c))
        {
            "zh-hans"
        } else {
            "en"
        };
        Ok(self
            .0
            .get(ENDPOINT)
            .header(header::ACCEPT, "application/json")
            .header("X-Subscription-Token", token)
            .query(&[
                ("q", query),
                ("count", "10"),
                ("country", "ALL"),
                ("result_filter", "web"),
                ("text_decorations", "false"),
                ("spellcheck", "false"),
                ("operators", "false"),
                ("search_lang", search_lang),
            ]))
    }

    async fn candidates(&self, query: &str, key: &str) -> Result<(usize, Vec<Url>), SearchFailure> {
        let req = self.request(query, key)?;
        let receipt = crate::request_receipt::begin(
            crate::request_receipt::Service::WebSearch,
            query.chars().count(),
        );
        let response = req.send().await.map_err(|error| {
            let status = if error.is_timeout() {
                DiagnosticStatus::Timeout
            } else {
                DiagnosticStatus::Connection
            };
            SearchFailure::new(status, None)
        })?;
        if let Some(h) = receipt {
            h.status(response.status().as_u16());
        }
        decode_candidate_response(response).await
    }
}

async fn decode_candidate_response(
    response: reqwest::Response,
) -> Result<(usize, Vec<Url>), SearchFailure> {
    let status = response.status();
    if status != StatusCode::OK {
        let mut error = SearchFailure::from_http(status);
        if status == StatusCode::UNPROCESSABLE_ENTITY && invalid_subscription(response).await {
            error.status = DiagnosticStatus::Unauthorized;
        }
        return Err(error);
    }
    let invalid = || SearchFailure::new(DiagnosticStatus::InvalidResponse, Some(status));
    if !identity_encoding(&response) {
        return Err(invalid());
    }
    let bytes = limited_body(response, MAX_SEARCH_BYTES)
        .await
        .map_err(|error| {
            let kind = match error {
                BodyReadError::TooLarge => DiagnosticStatus::InvalidResponse,
                BodyReadError::Timeout => DiagnosticStatus::Timeout,
                BodyReadError::Interrupted => DiagnosticStatus::Connection,
            };
            SearchFailure::new(kind, Some(status))
        })?;
    parse_hits(&bytes).ok_or_else(invalid)
}

async fn invalid_subscription(response: reqwest::Response) -> bool {
    #[derive(Deserialize)]
    struct Envelope {
        error: ErrorCode,
    }
    #[derive(Deserialize)]
    struct ErrorCode {
        code: String,
    }
    if !identity_encoding(&response) {
        return false;
    }
    let Ok(bytes) = limited_body(response, MAX_SEARCH_ERROR_BYTES).await else {
        return false;
    };
    serde_json::from_slice::<Envelope>(&bytes)
        .is_ok_and(|payload| payload.error.code == "SUBSCRIPTION_TOKEN_INVALID")
}

async fn discover(
    state: &AppState,
    query: &PublicQuery,
    cancel: &AtomicBool,
) -> Result<(usize, Vec<Url>), String> {
    let key = crate::read_key(state, KEY_KIND, ENDPOINT, cancel)
        .await?
        .ok_or("尚未配置 Brave Search API 密钥。请在设置中保存，或从旧钥匙串导入。")?;
    validate_key(&key)?;
    if !safe_to_dispatch(state, cancel) {
        return Err("联网搜索已关闭或取消".into());
    }
    BraveClient::new()?
        .candidates(&query.0, &key)
        .await
        .map_err(|error| error.warning())
}

fn query_terms(query: &str) -> Vec<String> {
    let mut terms = crate::db::query_terms(query);
    terms.extend(query.split_whitespace().map(str::to_lowercase));
    terms.sort();
    terms.dedup();
    terms
}

async fn find_pages(
    state: &AppState,
    query: PublicQuery,
    cancel: &AtomicBool,
) -> Result<WebResults, String> {
    let deadline = tokio::time::Instant::now() + WEB_TIMEOUT;
    let (searched, urls) = tokio::time::timeout_at(deadline, discover(state, &query, cancel))
        .await
        .map_err(|_| "联网搜索超时，本轮使用已取得的其他来源".to_string())??;
    if urls.is_empty() {
        return Ok(WebResults {
            discarded: searched,
            searched,
            evidence: vec![],
        });
    }
    let client = public_page_client()?;
    let terms = query_terms(&query.0);
    let mut tasks = stream::iter(urls.into_iter().enumerate())
        .map(|(rank, url)| {
            let client = &client;
            let terms = &terms;
            async move {
                let page = if safe_to_dispatch(state, cancel) {
                    fetch_page(client, url, terms).await
                } else {
                    None
                };
                (rank, page)
            }
        })
        .buffer_unordered(MAX_PAGES);
    let mut ready = vec![];
    while let Ok(Some((rank, page))) = tokio::time::timeout_at(deadline, tasks.next()).await {
        if let Some(page) = page {
            ready.push((rank, page));
        }
    }
    ready.sort_by_key(|(rank, _)| *rank);
    let mut content_hashes = HashSet::new();
    let evidence: Vec<_> = ready
        .into_iter()
        .map(|(_, page)| page)
        .filter(|page| content_hashes.insert(page.metadata.content_hash.clone()))
        .collect();
    Ok(WebResults {
        discarded: searched.saturating_sub(evidence.len()),
        searched,
        evidence,
    })
}

pub(crate) async fn search(
    state: &AppState,
    query: PublicQuery,
    cancel: &AtomicBool,
) -> Result<WebResults, String> {
    #[cfg(feature = "desktop-e2e")]
    {
        let _ = (state, query, cancel);
        Err("隔离验收环境关闭真实联网搜索".into())
    }
    #[cfg(not(feature = "desktop-e2e"))]
    {
        if !safe_to_dispatch(state, cancel) {
            return Err("联网搜索已关闭或取消".into());
        }
        let wait_cancel = async {
            while safe_to_dispatch(state, cancel) {
                tokio::time::sleep(Duration::from_millis(75)).await;
            }
        };
        tokio::select! {
            biased;
            _ = wait_cancel => Err("联网搜索已关闭或取消".into()),
            result = find_pages(state, query, cancel) => {
                if !safe_to_dispatch(state, cancel) {
                    return Err("联网搜索已关闭或取消".into());
                }
                result
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outbound_query_is_bounded_to_current_public_words() {
        assert!(safe_query(
            "比较我们制度和上海人社局 2026 年要求",
            "上海人社局 2026 官方"
        )
        .is_ok());
        assert!(safe_query("请查 Rust 1.90 发布说明", "rust 1.90 official").is_ok());
        assert!(safe_query("Check Rust 1.90.0.", "rust 1.90.0 official").is_ok());
        assert!(safe_query("Check Rust 1.90.0.", "rust 1.90 official").is_err());
        assert!(safe_query("请查最新版 Firefox", "Firefox 最新").is_ok());
        assert!(safe_query("请查 RustyTools", "Rust latest").is_err());
        assert!(safe_query("请找公开规范", "Acme latest").is_err());
        assert!(safe_query("请找公开规范", "latest official").is_err());
        assert!(safe_query("我的密码是 Abc123，顺便查 Rust", "Rust latest").is_err());
        assert!(safe_query("电话 138-1234-5678，查 Rust", "Rust latest").is_err());
        assert!(safe_query("只根据附件解释 Rust", "Rust latest").is_err());
        assert!(safe_query("不要联网，Rust 的最新版本是什么", "Rust latest").is_err());
        assert!(safe_query("请查 Rust site:foo.com", "Rust site:foo.com").is_err());
    }

    #[test]
    fn explicit_source_limits_override_an_online_plan() {
        for question in [
            "仅使用所选资料，核对 Python version",
            "不要访问互联网，核对 Python version",
            "不要访问外部网站。请核对 Python version。",
            "只根据选中的文件核对 Python version。",
            "只根据这两份文档核对 Python version。",
            "Check Python version without internet access",
            "Check Python version, do not use the web",
            "Check Python version, DON’T  USE THE WEB",
            "Do not access external websites. Check Python version.",
            "Only use the selected documents to check Python version.",
        ] {
            assert!(explicitly_offline(question), "{question}");
            assert!(
                safe_query(question, "Python version").is_err(),
                "{question}"
            );
        }
        let compare = "比较所选资料与 Python 官网最新 version";
        assert!(!explicitly_offline(compare));
        assert!(safe_query(compare, "Python version official").is_ok());
        for official in [
            "请只参考 Python 官网，核对 Python 3.14.0 的发布日期。",
            "Only use Python's official website to verify Python 3.14.0.",
        ] {
            assert!(!explicitly_offline(official), "{official}");
            assert!(
                safe_query(official, "Python 3.14.0 release").is_ok(),
                "{official}"
            );
        }
    }

    #[test]
    fn explicit_client_work_is_never_a_public_query() {
        assert!(safe_query("帮我梳理客户张三的星芒项目。", "张三 星芒项目").is_err());
        assert!(safe_query("Summarize my client Acme's project", "Acme project").is_err());
        assert!(safe_query("查最新版客户关系管理软件 Firefox", "Firefox latest").is_ok());
    }

    #[test]
    fn public_network_guard_blocks_private_reserved_and_literal_addresses() {
        for blocked in [
            "0.0.0.0",
            "10.1.2.3",
            "127.0.0.1",
            "100.64.0.1",
            "169.254.169.254",
            "172.16.0.1",
            "192.168.1.1",
            "192.0.0.8",
            "192.0.2.1",
            "198.18.0.1",
            "203.0.113.1",
            "224.0.0.1",
            "255.255.255.255",
            "::",
            "::1",
            "::ffff:8.8.8.8",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "2002:7f00:1::1",
            "64:ff9b::7f00:1",
            "3fff::1",
        ] {
            assert!(!globally_routable(blocked.parse().unwrap()), "{blocked}");
        }
        for accepted in ["8.8.8.8", "1.1.1.1", "2606:4700::1111"] {
            assert!(globally_routable(accepted.parse().unwrap()), "{accepted}");
        }
        for blocked in [
            "https://[::1]/",
            "https://127.1/",
            "https://2130706433/",
            "http://rust-lang.org/",
            "https://x.localhost/",
            "https://corp.internal/",
            "https://rust-lang.org:8443/",
            "https://user@rust-lang.org/",
            "https://rust-lang.org/?access_token=secret",
        ] {
            assert!(safe_page_url(blocked).is_none(), "{blocked}");
        }
        assert!(valid_source_url("https://rust-lang.org/news?id=1"));
        assert!(!valid_source_url(
            "https://rust-lang.org/news?id=1&utm_source=tracking"
        ));
    }

    #[test]
    fn brave_payload_uses_urls_only_and_canonicalizes_candidates() {
        let body = br#"{
            "web":{"results":[
                {"title":"untrusted result","url":"https://rust-lang.org/news?id=1&utm_source=tracking","description":"provider snippet"},
                {"url":"https://rust-lang.org/news?id=1#heading"},
                {"url":"https://rust-lang.org/?token=secret"},
                {"url":"http://10.0.0.1/"},
                {"url":"https://www.rust-lang.org/news"}
            ]}
        }"#;
        let (count, urls) = parse_hits(body).unwrap();
        assert_eq!(count, 5);
        assert_eq!(urls.len(), 2);
        assert_eq!(urls[0].as_str(), "https://rust-lang.org/news?id=1");
        assert!(parse_hits(b"invalid").is_none());
        assert!(parse_hits(br#"{}"#).is_none());
        assert!(parse_hits(br#"{"type":"error","message":"private"}"#).is_none());
        assert!(parse_hits(br#"{"type":"search","web":{}}"#).is_none());
        assert_eq!(parse_hits(br#"{"type":"search"}"#).unwrap().0, 0);
    }

    #[tokio::test]
    async fn diagnostic_response_classifies_http_failures_without_payload_details() {
        for (http, kind) in [
            (401, DiagnosticStatus::Unauthorized),
            (403, DiagnosticStatus::Forbidden),
            (429, DiagnosticStatus::RateLimited),
            (503, DiagnosticStatus::ProviderError),
            (302, DiagnosticStatus::UnexpectedStatus),
        ] {
            let response = tauri::http::Response::builder()
                .status(http)
                .body("error details the provider should not expose")
                .unwrap();
            let error = decode_candidate_response(response.into())
                .await
                .unwrap_err();
            assert_eq!(error.status, kind);
            assert_eq!(error.http_status.unwrap().as_u16(), http);
            assert!(!error.warning().contains("error details"));
        }
    }

    #[tokio::test]
    async fn diagnostic_maps_only_the_known_422_subscription_error() {
        let known = br#"{"error":{"code":"SUBSCRIPTION_TOKEN_INVALID","detail":"private"},"type":"ErrorResponse"}"#;
        let mut oversized = known.to_vec();
        oversized.resize(MAX_SEARCH_ERROR_BYTES + 1, b' ');
        for (encoding, body, kind) in [
            ("identity", known.to_vec(), DiagnosticStatus::Unauthorized),
            (
                "identity",
                br#"{"error":{"code":"VALIDATION","detail":"SUBSCRIPTION_TOKEN_INVALID"}}"#
                    .to_vec(),
                DiagnosticStatus::UnexpectedStatus,
            ),
            ("gzip", known.to_vec(), DiagnosticStatus::UnexpectedStatus),
            ("identity", oversized, DiagnosticStatus::UnexpectedStatus),
        ] {
            let response = tauri::http::Response::builder()
                .status(422)
                .header(header::CONTENT_ENCODING, encoding)
                .body(body)
                .unwrap();
            let error = decode_candidate_response(response.into())
                .await
                .unwrap_err();
            assert_eq!(error.status, kind);
            assert_eq!(error.http_status, Some(StatusCode::UNPROCESSABLE_ENTITY));
            assert!(!error.warning().contains("private"));
        }
    }

    #[tokio::test]
    async fn diagnostic_response_distinguishes_empty_malformed_and_oversized() {
        let no_hits = tauri::http::Response::builder()
            .body(r#"{"type":"search","web":{"results":[]}}"#)
            .unwrap();
        assert_eq!(
            decode_candidate_response(no_hits.into()).await.unwrap(),
            (0, vec![])
        );
        for (encoding, body) in [
            ("identity", b"<html>bad gateway</html>".to_vec()),
            ("gzip", br#"{"type":"search"}"#.to_vec()),
            ("identity", vec![b'a'; MAX_SEARCH_BYTES + 1]),
        ] {
            let response = tauri::http::Response::builder()
                .header(header::CONTENT_ENCODING, encoding)
                .body(body)
                .unwrap();
            let error = decode_candidate_response(response.into())
                .await
                .unwrap_err();
            assert_eq!(error.status, DiagnosticStatus::InvalidResponse);
            assert_eq!(error.http_status, Some(StatusCode::OK));
        }
    }

    #[tokio::test]
    async fn diagnostic_invalid_key_stops_without_a_request_or_reported_secret() {
        let report = run_diagnostic("fake\rkey").await;
        assert_eq!(
            serde_json::to_value(report).unwrap(),
            serde_json::json!({
                "status": "invalid_key",
                "searchElapsedMs": null,
                "pageElapsedMs": null,
                "candidateCount": null,
                "httpStatus": null
            })
        );
    }

    #[test]
    fn diagnostic_search_request_uses_fixed_query_and_brave_only_sensitive_header() {
        let search = BraveClient::new()
            .unwrap()
            .request(DIAGNOSTIC_QUERY, "fixture-key")
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(search.url().host_str(), Some("api.search.brave.com"));
        assert_eq!(search.url().path(), "/res/v1/web/search");
        assert!(search.url().query_pairs().any(|(name, value)| {
            name == "q" && value == "Rust programming language documentation"
        }));
        assert!(!search.url().as_str().contains("fixture-key"));
        assert!(search.headers()["x-subscription-token"].is_sensitive());
        let page = public_page_client()
            .unwrap()
            .get("https://www.rust-lang.org/learn")
            .build()
            .unwrap();
        assert!(!page.headers().contains_key("x-subscription-token"));
    }

    #[tokio::test]
    async fn only_the_fixed_brave_host_enters_the_proxy_tunnel_without_exposing_the_key() {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let proxy = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(3);
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error)
                        if error.kind() == io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("proxy received no CONNECT: {error}"),
                }
            };
            // macOS may inherit O_NONBLOCK from the listener on an accepted socket.
            // The fixture reads the CONNECT header with blocking BufRead.
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = String::new();
            let mut reader = BufReader::new(&socket);
            loop {
                let before = request.len();
                if reader.read_line(&mut request).unwrap() == 0 || &request[before..] == "\r\n" {
                    break;
                }
            }
            socket
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
            request
        });
        let client = BraveClient(
            bounded_https_client()
                .proxy(reqwest::Proxy::https(format!("http://{address}")).unwrap())
                .build()
                .unwrap(),
        );
        let error = client
            .candidates(DIAGNOSTIC_QUERY, "fixture-key")
            .await
            .unwrap_err();
        assert_eq!(error.status, DiagnosticStatus::Connection);
        let tunnel = proxy.join().unwrap();
        assert_eq!(
            tunnel.lines().next(),
            Some("CONNECT api.search.brave.com:443 HTTP/1.1")
        );
        assert!(!tunnel.to_ascii_lowercase().contains("x-subscription-token"));
        assert!(!tunnel.contains("fixture-key"));
        assert!(!tunnel.contains(DIAGNOSTIC_QUERY));

        let page_trap = TcpListener::bind("127.0.0.1:0").unwrap();
        page_trap.set_nonblocking(true).unwrap();
        let page_port = page_trap.local_addr().unwrap().port();
        let pages = public_page_client().unwrap();
        assert!(pages
            .get(format!("https://localhost:{page_port}"))
            .send()
            .await
            .is_err());
        assert_eq!(
            page_trap.accept().unwrap_err().kind(),
            io::ErrorKind::WouldBlock,
            "untrusted page URL reached a private listener"
        );
    }

    #[tokio::test]
    #[ignore = "explicit real-network transport smoke; sends a fixed public query with a fake token"]
    async fn verify_live_brave_and_public_page() {
        assert_eq!(
            std::env::var("INKSTONE_V086_LIVE_NETWORK").as_deref(),
            Ok("1"),
            "set INKSTONE_V086_LIVE_NETWORK=1 to send the fixed public diagnostic query"
        );
        let query = safe_query(DIAGNOSTIC_QUERY, DIAGNOSTIC_QUERY).unwrap();
        let report = run_diagnostic("inkstone-fixture-not-a-real-key").await;
        println!(
            "Brave fixed-origin transport, invalid token: {}",
            serde_json::to_string(&report).unwrap()
        );
        assert_eq!(
            report.status,
            DiagnosticStatus::Unauthorized,
            "this smoke expects the API to reject a fake token"
        );
        assert!(matches!(report.http_status, Some(401 | 422)));
        assert_eq!(query.0.to_lowercase(), DIAGNOSTIC_QUERY.to_lowercase());

        let pages = public_page_client().unwrap();
        let url = safe_page_url("https://doc.rust-lang.org/book/").unwrap();
        let page = fetch_page(&pages, url, &query_terms(DIAGNOSTIC_QUERY)).await;
        assert!(
            page.is_some(),
            "known public page was not directly readable"
        );
        println!("direct public HTTPS response yielded relevant source evidence");
    }

    #[test]
    fn excerpt_keeps_complete_relevant_blocks_in_document_order() {
        let blocks = vec![
            "有关 Rust 的第一页".into(),
            "第二页没有相关说明".into(),
            "Rust 的版本细节及所有适用条件".into(),
            "超".repeat(MAX_EXCERPT_CHARS + 1),
        ];
        let text = excerpt(&blocks, &["rust".into(), "超超".into()]);
        assert_eq!(text, "有关 Rust 的第一页\n\nRust 的版本细节及所有适用条件");
    }
}
