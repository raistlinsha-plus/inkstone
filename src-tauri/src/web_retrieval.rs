//! Explicitly enabled public web discovery and direct, read-only page retrieval.
//! Brave response snippets are deliberately neither read nor persisted.
#[path = "web_retrieval/html.rs"]
mod html;

use crate::{files, providers, AppState};
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
    time::Duration,
};
use tauri::State;

const ENDPOINT: &str = "https://api.search.brave.com/res/v1/web/search";
const KEY_KIND: &str = "web-brave";
const SEARCH_RESULTS: usize = 10;
const MAX_PAGES: usize = 4;
const MAX_SEARCH_BYTES: usize = 384 * 1024;
const MAX_PAGE_BYTES: usize = 768 * 1024;
const MAX_EXCERPT_CHARS: usize = 2400;
const WEB_TIMEOUT: Duration = Duration::from_secs(8);

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
        has_key: providers::has_key_for(KEY_KIND, ENDPOINT, false)?,
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
        if enabled && key.is_none() && !providers::has_key_for(KEY_KIND, ENDPOINT, false)? {
            return Err("启用前请填写 Brave Search API 密钥".into());
        }
        if clear || key.is_some() {
            crate::check_idle(&state)?;
            let pending = state.credentials.pending();
            state.credentials.invalidate();
            if pending {
                return Err(crate::credentials::PENDING.into());
            }
            providers::set_key_for(KEY_KIND, ENDPOINT, key, clear)?;
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
    if explicitly_offline(question) || sensitive(question) || sensitive(proposed) {
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
    let q = question.to_lowercase();
    [
        "别联网",
        "不联网",
        "不要联网",
        "无需联网",
        "禁止联网",
        "只用本地",
        "仅用本地",
        "只看本地",
        "仅限本地",
        "只按这份",
        "只按这些",
        "仅按这份",
        "只看这份",
        "只用这份",
        "只根据",
        "仅根据",
        "只参考",
        "仅参考",
        "不查网页",
        "别查网页",
        "不要查网页",
        "不要搜索网页",
        "不要用搜索",
        "不使用搜索",
        "离线回答",
        "无需上网",
        "别上网",
        "不上网",
        "no web",
        "don't search",
        "do not search",
        "do not browse",
        "don't browse",
        "offline only",
        "use only",
        "only use",
        "based only on",
        "local only",
    ]
    .iter()
    .any(|needle| q.contains(needle))
}

fn appears_in_question(question: &str, word: &str) -> bool {
    if !word.is_ascii() {
        return question.contains(word);
    }
    // ASCII tokens must not be newly extracted from larger words/identifiers.
    let part = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '+');
    question.match_indices(word).any(|(start, _)| {
        !question[..start].chars().next_back().is_some_and(part)
            && !question[start + word.len()..]
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
    web: Option<WebBlock>,
}
#[derive(Deserialize)]
struct WebBlock {
    #[serde(default)]
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

fn public_client() -> Result<Client, String> {
    Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .no_proxy()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .http1_only()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .pool_max_idle_per_host(0)
        .dns_resolver(Arc::new(PublicResolver))
        .user_agent("Inkstone/0.7 (+local desktop public web retrieval)")
        .build()
        .map_err(|_| "无法初始化安全网页读取客户端".into())
}

async fn limited_body(response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("网页或搜索响应超过大小限制".into());
    }
    let mut body = Vec::new();
    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.map_err(|_| "网页或搜索响应读取中断")?;
        if chunk.len() > limit - body.len() {
            return Err("网页或搜索响应超过大小限制".into());
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

fn parse_hits(bytes: &[u8]) -> Result<(usize, Vec<Url>), String> {
    let payload: SearchResponse =
        serde_json::from_slice(bytes).map_err(|_| "搜索服务返回的结果格式无效")?;
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
    Ok((count, urls))
}

fn safe_to_dispatch(state: &AppState, cancel: &AtomicBool) -> bool {
    !cancel.load(Ordering::SeqCst) && is_enabled(state)
}

async fn fetch_page(
    client: &Client,
    url: Url,
    terms: &[String],
    state: &AppState,
    cancel: &AtomicBool,
) -> Option<WebEvidence> {
    if !safe_to_dispatch(state, cancel) {
        return None;
    }
    let response = client
        .get(url.clone())
        .header(header::ACCEPT, "text/html,text/plain")
        .send()
        .await
        .ok()?;
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

async fn discover(
    state: &AppState,
    query: &PublicQuery,
    cancel: &AtomicBool,
) -> Result<(Client, usize, Vec<Url>), String> {
    let key = crate::read_key(state, KEY_KIND, ENDPOINT, cancel)
        .await?
        .ok_or("尚未配置 Brave Search API 密钥")?;
    validate_key(&key)?;
    if !safe_to_dispatch(state, cancel) {
        return Err("联网搜索已关闭或取消".into());
    }
    let client = public_client()?;
    let mut token =
        header::HeaderValue::from_str(&key).map_err(|_| "Brave Search API 密钥格式无效")?;
    token.set_sensitive(true);
    let search_lang = if query
        .0
        .chars()
        .any(|c| ('\u{3400}'..='\u{9fff}').contains(&c))
    {
        "zh-hans"
    } else {
        "en"
    };
    let response = client
        .get(ENDPOINT)
        .header(header::ACCEPT, "application/json")
        .header("X-Subscription-Token", token)
        .query(&[
            ("q", query.0.as_str()),
            ("count", "10"),
            ("country", "ALL"),
            ("result_filter", "web"),
            ("text_decorations", "false"),
            ("spellcheck", "false"),
            ("operators", "false"),
            ("search_lang", search_lang),
        ])
        .send()
        .await
        .map_err(|_| "连接 Brave Search 失败")?;
    if !response_is_public(&response) {
        return Err("搜索服务的连接地址无法验证".into());
    }
    match response.status() {
        StatusCode::OK => {}
        StatusCode::TOO_MANY_REQUESTS => return Err("搜索服务额度或速率受限，请稍后再试".into()),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            return Err("搜索服务拒绝密钥，请检查设置".into())
        }
        status => return Err(format!("搜索服务返回 HTTP {}", status.as_u16())),
    }
    if !identity_encoding(&response) {
        return Err("搜索服务返回了不支持的压缩格式".into());
    }
    let (searched, urls) = parse_hits(&limited_body(response, MAX_SEARCH_BYTES).await?)?;
    Ok((client, searched, urls))
}

async fn find_pages(
    state: &AppState,
    query: PublicQuery,
    cancel: &AtomicBool,
) -> Result<WebResults, String> {
    let deadline = tokio::time::Instant::now() + WEB_TIMEOUT;
    let (client, searched, urls) =
        tokio::time::timeout_at(deadline, discover(state, &query, cancel))
            .await
            .map_err(|_| "联网搜索超时，本轮使用已取得的其他来源".to_string())??;
    let mut terms = crate::db::query_terms(&query.0);
    terms.extend(query.0.split_whitespace().map(str::to_lowercase));
    terms.sort();
    terms.dedup();
    let mut tasks = stream::iter(urls.into_iter().enumerate())
        .map(|(rank, url)| {
            let page = fetch_page(&client, url, &terms, state, cancel);
            async move { (rank, page.await) }
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
        assert!(parse_hits(b"invalid").is_err());
        assert_eq!(parse_hits(br#"{"type":"search"}"#).unwrap().0, 0);
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
