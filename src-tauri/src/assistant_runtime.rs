//! Routing and evidence preparation shared by scoped and standalone answers.
use crate::{
    answer_validation, assistant,
    assistant_sources::{Evidence, ExternalSource, Trace, WebAccess},
    db, documents, files, library,
    models::{ChatResponse, ChatStatusEvent, Provider, SearchResult},
    providers, retrieval, web_retrieval, AppState,
};
use std::{collections::HashSet, sync::atomic::Ordering, time::Duration};
use tauri::Emitter;

const GENERAL_SYSTEM: &str = "你是砚台 AI 助手。按当前用户请求进行解释、写作、翻译、代码示例或对话。使用清晰的 Markdown。上轮回答仅作编辑与追问语境，不代表已核验事实。不要伪造引用、声称已经联网或执行操作。输出不要包含 HTML 和远程图片。";

#[derive(Default)]
pub struct WebTurn {
    pub evidence: Vec<Evidence>,
    pub expected: bool,
    pub warning: Option<String>,
    examined: Option<usize>,
}

pub fn progress(app: &tauri::AppHandle, request_id: &str, stage: &str, detail: &str) {
    let _ = app.emit(
        "chat-status",
        ChatStatusEvent {
            request_id: request_id.into(),
            stage: stage.into(),
            detail: detail.into(),
        },
    );
}

#[derive(Debug, PartialEq, Eq)]
enum WebRoute {
    Skip,
    Blocked,
    Plan { evidence_expected: bool },
}

// Quoted input is content to transform, not a search instruction. Keep an
// unmatched quote literal so it cannot hide the rest of a user's request.
fn request_text(question: &str) -> (String, bool) {
    let mut remaining = question;
    let mut request = String::new();
    let mut quoted = false;
    while let Some((at, open)) = remaining
        .char_indices()
        .find(|(_, c)| matches!(c, '“' | '‘' | '「' | '『' | '"' | '`'))
    {
        let close = match open {
            '“' => '”',
            '‘' => '’',
            '「' => '」',
            '『' => '』',
            _ => open,
        };
        let end = at + open.len_utf8();
        let tail = &remaining[end..];
        if let Some(close_at) = tail.find(close) {
            request.push_str(&remaining[..at]);
            request.push(' ');
            quoted |= !tail[..close_at].trim().is_empty();
            remaining = &tail[close_at + close.len_utf8()..];
        } else {
            request.push_str(&remaining[..end]);
            remaining = tail;
        }
    }
    request.push_str(remaining);
    (request.to_lowercase(), quoted)
}

fn transforms_text(request: &str) -> bool {
    [
        "翻译",
        "改写",
        "润色",
        "重写",
        "校对",
        "总结",
        "概括",
        "提炼",
        "translate",
        "rewrite",
        "rephrase",
        "proofread",
        "summarize",
        "summarise",
        "paraphrase",
    ]
    .iter()
    .any(|term| request.contains(term))
}

fn web_route(question: &str, access: WebAccess) -> WebRoute {
    let (request, quoted) = request_text(question);
    let has = |terms: &[&str]| terms.iter().any(|term| request.contains(term));
    let textual_limit = web_retrieval::explicitly_offline(question);
    let explicit_lookup = has(&[
        "联网搜",
        "联网查",
        "上网查",
        "网上查",
        "搜索网页",
        "搜索互联网",
        "浏览网页",
        "帮我查",
        "search the web",
        "search online",
        "look up online",
        "browse the web",
    ]);
    let public_source = has(&[
        "官网",
        "官方网站",
        "公开报道",
        "官方公告",
        "官方文档",
        "official website",
        "official site",
        "official announcement",
    ]) || (!textual_limit && has(&["网页", "网站", "webpage", "website"]));
    let fresh = has(&[
        "最新",
        "刚刚",
        "今天",
        "今日",
        "实时",
        "latest",
        "today",
        "current price",
        "live price",
    ]);
    let current = fresh || has(&["当前", "目前", "明天", "current", "tomorrow"]);
    let verification = has(&[
        "核对",
        "核实",
        "查证",
        "查询",
        "verify",
        "fact-check",
        "look up",
    ]);
    let revision = transforms_text(&request);
    let writing = has(&["写一", "写封", "拟一", "draft a", "write a"]);
    let needs_source = revision && public_source && !quoted;
    if (revision || writing)
        && !explicit_lookup
        && !(verification && (current || public_source))
        && !needs_source
    {
        return WebRoute::Skip;
    }
    let evidence_expected = explicit_lookup
        || public_source
        || fresh
        || (current && verification)
        || (current
            && has(&[
                "天气",
                "气温",
                "新闻",
                "价格",
                "汇率",
                "开门",
                "营业",
                "weather",
                "news",
                "price",
                "opening hours",
            ]));
    if access == WebAccess::LocalOnly || textual_limit {
        if evidence_expected {
            WebRoute::Blocked
        } else {
            WebRoute::Skip
        }
    } else {
        WebRoute::Plan { evidence_expected }
    }
}

pub async fn web(
    app: Option<&tauri::AppHandle>,
    state: &AppState,
    config: &Provider,
    question: &str,
    request_id: &str,
    access: WebAccess,
) -> WebTurn {
    let expected = match web_route(question, access) {
        WebRoute::Skip => return WebTurn::default(),
        WebRoute::Blocked => {
            return WebTurn {
                expected: true,
                warning: Some("本轮未搜索公开网页，公开信息未核验。".into()),
                ..Default::default()
            }
        }
        WebRoute::Plan { evidence_expected } => evidence_expected,
    };
    let unavailable = |reason: &str| WebTurn {
        expected,
        warning: expected.then(|| reason.to_string()),
        ..Default::default()
    };
    if !web_retrieval::is_enabled(state) {
        return unavailable("自动联网尚未配置或已关闭，公开时效资料未核验。");
    }
    if let Some(app) = app {
        progress(app, request_id, "planning", "正在判断本轮需要哪些来源");
    }
    let cancel = &state.cancel_chat;
    let plan = async {
        let key = crate::read_key(state, "chat", &config.base_url, cancel).await?;
        providers::complete_json(&state.client, config, key.as_deref(),
            r#"只根据当前问题判断是否需要查询公开网页。最新公开事实、官网核对、外部对照需要查。写作、翻译、概念解释和内部材料问题通常不需要。用户限定仅用指定材料或不联网时返回 false。仅输出 JSON {"search":true,"query":"可公开查询的短语"} 或 {"search":false,"query":""}。查询词应取自用户当前问题，去除私人信息、路径和标识；无法提取安全的公开目标时返回 false。"#,
            &question.chars().take(1500).collect::<String>(), cancel).await
    };
    let plan = match tokio::time::timeout(Duration::from_secs(5), plan).await {
        Ok(Ok(value)) => value,
        _ => return unavailable("联网规划不可用，公开资料未核验。"),
    };
    if plan["search"].as_bool() != Some(true) {
        return unavailable("未找到适合本轮的公开查询，公开资料未核验。");
    }
    let query = match web_retrieval::safe_query(question, plan["query"].as_str().unwrap_or("")) {
        Ok(query) => query,
        Err(_) => {
            return WebTurn {
                expected: true,
                warning: Some("公开查询未通过范围校验，没有发送搜索词。".into()),
                ..Default::default()
            }
        }
    };
    if let Some(app) = app {
        progress(app, request_id, "web_search", "正在搜索网页并核对公开来源");
    }
    finish_web_search(web_retrieval::search(state, query, cancel).await)
}

fn finish_web_search(result: Result<web_retrieval::WebResults, String>) -> WebTurn {
    match result {
        Ok(result) => {
            let mut out = WebTurn {
                expected: true,
                examined: Some(result.searched),
                ..Default::default()
            };
            for item in result.evidence {
                let metadata = item.metadata;
                out.evidence.push(Evidence {
                    text: item.text,
                    metadata: ExternalSource {
                        id: files::hash(metadata.url.as_bytes()),
                        kind: "web".into(),
                        label: metadata
                            .title
                            .chars()
                            .filter(|c| !c.is_control())
                            .take(240)
                            .collect(),
                        citation: 0,
                        url: Some(metadata.url),
                        excerpt: None,
                        captured_at: Some(metadata.fetched_at),
                        published_at: metadata.published_at,
                        content_hash: Some(metadata.content_hash),
                        attachment_id: None,
                        project_id: None,
                        document_id: None,
                    },
                });
            }
            if result.searched == 0 {
                out.warning = Some("本轮公开搜索未返回网页候选。".into());
            } else if out.evidence.is_empty() {
                out.warning = Some("未取得可引用的网页正文，搜索摘要未用作证据。".into());
            } else if result.discarded > 0 {
                out.warning = Some(format!(
                    "{} 条网页候选无法安全读取或已去重。",
                    result.discarded
                ));
            }
            out
        }
        // search() returns a bounded, user-facing reason without request data.
        Err(reason) => WebTurn {
            expected: true,
            warning: Some(format!(
                "{}。公开资料未核验，可在「模型与设置 → 自动联网设置」测试连接。",
                reason.trim_end_matches('。'),
            )),
            ..Default::default()
        },
    }
}

pub fn select_external(
    items: &[Evidence],
    base: usize,
    remaining: usize,
    omitted: &mut Vec<String>,
) -> Vec<Evidence> {
    let mut remaining = remaining;
    let mut selected = Vec::new();
    for item in items {
        if selected.len() >= 32 {
            break;
        }
        let citation = base + selected.len() + 1;
        let cost = item.as_prompt_with_citation(citation).chars().count();
        if cost > remaining {
            if !omitted.contains(&item.metadata.label) {
                omitted.push(item.metadata.label.clone());
            }
            continue;
        }
        remaining -= cost;
        let mut item = item.clone();
        item.metadata.citation = citation;
        selected.push(item);
    }
    selected
}

pub(crate) fn local_first<T>(
    budget: usize,
    has_web: bool,
    mut select: impl FnMut(usize) -> Vec<T>,
) -> Vec<T> {
    if has_web {
        let reserved = select(budget * 2 / 3);
        if !reserved.is_empty() {
            return reserved;
        }
    }
    select(budget)
}

fn choose_external_context(
    local: &[Evidence],
    public: &[Evidence],
    budget: usize,
    unread: &mut Vec<String>,
) -> Vec<Evidence> {
    let preexisting_unread = unread.len();
    let mut selected = local_first(budget, !local.is_empty() && !public.is_empty(), |allowed| {
        unread.truncate(preexisting_unread);
        select_external(local, 0, allowed, unread)
    });
    if public.is_empty() {
        return selected;
    }
    let used = selected.iter().map(|e| e.as_prompt().chars().count()).sum();
    selected.extend(select_external(
        public,
        selected.len(),
        budget.saturating_sub(used),
        unread,
    ));
    selected
}

fn snippets(question: &str, path: &str, content: &str) -> Vec<(String, usize, usize)> {
    if content.trim().is_empty() {
        return Vec::new();
    }
    if content.chars().count() <= 2800 {
        return vec![(content.to_string(), 1, content.lines().count())];
    }
    let terms = db::query_terms(question);
    let mut chunks = db::local_chunks(content, path, 1800);
    chunks.sort_by_key(|chunk| {
        std::cmp::Reverse(
            terms
                .iter()
                .filter(|t| {
                    chunk.heading.to_lowercase().contains(t.as_str())
                        || chunk.text.to_lowercase().contains(t.as_str())
                })
                .count(),
        )
    });
    crate::evidence::prioritize_selected_excerpts(question, path, &mut chunks);
    chunks
        .into_iter()
        .take(2)
        .map(|c| (c.text, c.start_line, c.end_line))
        .collect()
}

fn clock_snippets(clock: &str, title: &str, content: &str) -> Vec<(String, usize, usize)> {
    use assistant::grounding::supports_clock;

    let mut parts = snippets(clock, title, content);
    parts.retain(|(text, _, _)| supports_clock(text, clock));
    if parts.is_empty() && content.chars().count() > 2800 {
        // The canonical search term and its spelling in the original may
        // differ. The original must actually contain the requested time.
        parts = db::local_chunks(content, title, 1800)
            .into_iter()
            .filter(|chunk| supports_clock(&chunk.text, clock))
            .take(2)
            .map(|c| (c.text, c.start_line, c.end_line))
            .collect();
    }
    parts
}

fn prior_local_source_matches(
    sources: &[ExternalSource],
    id: &str,
    project: Option<&str>,
    content: &str,
) -> bool {
    let hash = files::hash(content);
    sources.iter().any(|source| {
        let same_source = if let Some(project) = project {
            source.kind == "document"
                && source.project_id.as_deref() == Some(project)
                && source.document_id.as_deref() == Some(id)
        } else {
            source.kind == "attachment" && source.attachment_id.as_deref() == Some(id)
        };
        same_source && source.content_hash.as_deref() == Some(hash.as_str())
    })
}

fn local_item(
    kind: &str,
    id: &str,
    title: &str,
    project: Option<&str>,
    content: &str,
    part: (String, usize, usize),
) -> Evidence {
    let (text, start, end) = part;
    let excerpt = (kind == "document").then(|| text.chars().take(3000).collect());
    Evidence {
        metadata: ExternalSource {
            id: format!("{id}:{start}-{end}"),
            kind: kind.into(),
            label: format!("{title} · 第 {start}–{end} 行"),
            citation: 0,
            url: None,
            excerpt,
            captured_at: None,
            published_at: None,
            attachment_id: (kind == "attachment").then(|| id.into()),
            project_id: project.map(str::to_string),
            document_id: (kind == "document").then(|| id.into()),
            content_hash: Some(files::hash(content)),
        },
        text,
    }
}

fn document(
    data: &std::path::Path,
    project: &str,
    id: &str,
) -> Result<(library::Document, String), String> {
    let doc = library::get(data, id)?;
    if doc.project_id != project || doc.status != "ready" {
        return Err("所选文档不在当前授权空间或已移除".into());
    }
    let root = library::project_root(data, project)?;
    let content = files::read_text(&files::resolve(&root, &doc.path, false)?)?;
    Ok((doc, content))
}

fn original(
    data: &std::path::Path,
    conversation: &str,
    m: &ExternalSource,
) -> Option<(String, String)> {
    match m.kind.as_str() {
        "attachment" => m
            .attachment_id
            .as_deref()
            .and_then(|id| assistant::attachments::read(data, conversation, id).ok())
            .map(|a| (a.title, a.text)),
        "document" => m
            .project_id
            .as_deref()
            .zip(m.document_id.as_deref())
            .and_then(|(project, id)| document(data, project, id).ok())
            .map(|(d, text)| (d.title, text)),
        _ => None,
    }
}
fn current(data: &std::path::Path, conversation: &str, items: &[Evidence]) -> bool {
    items.iter().all(|e| {
        e.metadata.kind == "web"
            || original(data, conversation, &e.metadata).is_some_and(|(_, text)| {
                e.metadata.content_hash.as_deref() == Some(files::hash(text).as_str())
            })
    })
}

fn selected_passages(
    data: &std::path::Path,
    conversation: &str,
    items: &[Evidence],
) -> Result<Vec<SearchResult>, String> {
    let mut out = Vec::new();
    for item in items {
        let m = &item.metadata;
        let (title, body) =
            original(data, conversation, m).ok_or("所选资料已删除或不属于当前范围")?;
        let hash = files::hash(&body);
        if m.content_hash.as_deref() != Some(&hash) {
            return Err("所选文档或附件已变化，请重新提问".into());
        }
        let id = m
            .document_id
            .as_ref()
            .or(m.attachment_id.as_ref())
            .ok_or("所选资料缺少身份")?;
        // local_item builds the coordinates from the original snippet.
        let (start, end) =
            m.id.strip_prefix(id)
                .and_then(|s| s.strip_prefix(':'))
                .and_then(|s| s.split_once('-'))
                .and_then(|(a, b)| Some((a.parse::<usize>().ok()?, b.parse::<usize>().ok()?)))
                .ok_or("所选资料的行号无效")?;
        let lines = body.lines().collect::<Vec<_>>();
        if start == 0 || end < start || end > lines.len() {
            return Err("所选资料的行号已变化".into());
        }
        let mut hit = crate::candidate_reading::explicit_passage(
            id,
            &title,
            &hash,
            start,
            end,
            lines[start - 1..end].join("\n"),
        );
        hit.document_id = m.document_id.clone();
        out.push(hit);
    }
    Ok(out)
}

pub fn record_web_search(trace: &mut Trace, web: &WebTurn) {
    if let Some(examined) = web.examined {
        trace
            .steps
            .push(format!("公开网页 · 检查 {examined} 条候选"));
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum AnswerRoute {
    Direct,
    Local,
    Mixed,
    Web,
    NoLocalEvidence,
    NoWebEvidence,
}

impl AnswerRoute {
    pub(crate) fn from_context(
        require_local: bool,
        expect_web: bool,
        has_local: bool,
        has_web: bool,
    ) -> Self {
        match (has_local, has_web) {
            (true, true) => Self::Mixed,
            (true, false) => Self::Local,
            // Web pages may supplement local evidence, but can never stand in for the
            // authorized local scope, including when its excerpts did not fit the budget.
            (false, _) if require_local => Self::NoLocalEvidence,
            (false, true) => Self::Web,
            (false, false) if expect_web => Self::NoWebEvidence,
            (false, false) => Self::Direct,
        }
    }

    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Local => "local",
            Self::Mixed => "mixed",
            Self::Web => "web",
            Self::NoLocalEvidence => "no-evidence",
            Self::NoWebEvidence => "web-unavailable",
        }
    }
}

pub async fn general(
    app: Option<&tauri::AppHandle>,
    state: &AppState,
    started: &assistant::Started,
    request: &str,
    mode: &str,
    memory: &assistant::memory::Options,
) -> Result<ChatResponse, String> {
    let generation = state.workspace_generation.load(Ordering::SeqCst);
    let config = crate::settings(state)?.chat;
    if !config.enabled {
        return Err("请在模型设置中启用问答服务".into());
    }
    let selection = started.sources.as_ref().ok_or("本轮资料范围未保存")?;
    let question = started.grounded_question.as_str();
    let data = &state.data_dir;
    let project = selection.project_id.as_deref();
    let clock = (!selection.is_empty())
        .then(|| {
            assistant::grounding::followup_clock(
                question,
                started.previous_questions.last().map(String::as_str),
            )
        })
        .flatten();
    // A literal date from the previous question narrows possible referents.
    // The date must also exist in the selected, still-current original.
    let prior_day = clock.and_then(|_| assistant::grounding::prior_clock_day(started));
    let selected_parts = |id: &str, project: Option<&str>, title: &str, content: &str| {
        if let Some(clock) = clock {
            if !prior_local_source_matches(&started.previous_local_sources, id, project, content)
                || prior_day.is_some_and(|day| {
                    !crate::evidence::month_days(content).any(|date| date == day)
                })
            {
                return Vec::new();
            }
            clock_snippets(clock, title, content)
        } else {
            snippets(question, title, content)
        }
    };
    let local_search = async {
        let mut items = Vec::new();
        let mut steps = Vec::new();
        let mut unread = Vec::new();
        let mut notices = Vec::new();
        let mut mode_used = "direct".to_string();
        let mut rank_used = "not-requested".to_string();
        let mut source_pool = Vec::<Vec<Evidence>>::new();
        for id in &selection.attachments {
            let a = assistant::attachments::read(data, &started.conversation_id, id)?;
            let parts = selected_parts(id, None, &a.title, &a.text);
            if a.text.chars().count() > 2800 {
                unread.push(format!("{} · 仅读取相关片段", a.title));
            }
            source_pool.push(
                parts
                    .into_iter()
                    .map(|part| local_item("attachment", id, &a.title, None, &a.text, part))
                    .collect(),
            );
        }
        if !selection.attachments.is_empty() {
            steps.push(format!("临时附件 · {} 份", selection.attachments.len()));
        }
        if let Some(project) = project {
            let ws = documents::library_workspace(data, project)?;
            if selection.document_ids.is_empty() && clock.is_none() {
                let found = crate::search_workspace(
                    state,
                    question,
                    None,
                    mode != "keyword",
                    Some(mode),
                    &state.cancel_chat,
                    app.map(|app| (app, request)),
                    Some(ws.clone()),
                )
                .await?;
                mode_used = found.retrieval_mode.clone();
                rank_used = found.rerank_status.clone();
                if let Some(warning) = found.warning {
                    notices.push(warning);
                }
                let results = retrieval::generation_context(
                    &ws,
                    &found.results,
                    config.context_chars / 2,
                    false,
                );
                if results.iter().any(|r| r.match_kind.contains("wiki")) {
                    steps.push("Wiki · 按主题定位原文片段".into());
                }
                let total = crate::managed_sources(data, &ws)?.map_or(0, |entries| entries.len());
                let found_docs = results
                    .iter()
                    .filter_map(|r| r.document_id.as_ref())
                    .collect::<HashSet<_>>()
                    .len();
                steps.push(format!("空间原文 · 已取证 {found_docs} 篇"));
                if found_docs < total {
                    unread.push(format!(
                        "空间内另有 {} 篇未进入本轮证据",
                        total - found_docs
                    ));
                }
                for r in results {
                    if let Some(id) = r.document_id.as_deref() {
                        let (doc, content) = document(data, project, id)?;
                        if files::hash(&content) == r.hash {
                            items.push(local_item(
                                "document",
                                id,
                                &doc.title,
                                Some(project),
                                &content,
                                (r.text, r.start_line, r.end_line),
                            ));
                        }
                    }
                }
            } else {
                let mut prior_ids = HashSet::new();
                let mut ids = selection
                    .document_ids
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                if ids.is_empty() {
                    ids.extend(started.previous_local_sources.iter().filter_map(|source| {
                        let id = source.document_id.as_deref()?;
                        (source.project_id.as_deref() == Some(project) && prior_ids.insert(id))
                            .then_some(id)
                    }));
                }
                for id in &ids {
                    let (doc, content) = match document(data, project, id) {
                        Ok(current) => current,
                        Err(_) if selection.document_ids.is_empty() => continue,
                        Err(error) => return Err(error),
                    };
                    let parts = selected_parts(id, Some(project), &doc.title, &content);
                    if content.chars().count() > 2800 {
                        unread.push(format!("{} · 仅读取相关片段", doc.title));
                    }
                    source_pool.push(
                        parts
                            .into_iter()
                            .map(|part| {
                                local_item(
                                    "document",
                                    id,
                                    &doc.title,
                                    Some(project),
                                    &content,
                                    part,
                                )
                            })
                            .collect(),
                    );
                }
                steps.push(format!("直接查阅 · {} 篇文档", ids.len()));
            }
        }
        // Make the first excerpt of every selected input compete before second excerpts.
        let mut second = Vec::new();
        for group in source_pool {
            for (index, item) in group.into_iter().enumerate() {
                if index == 0 {
                    items.push(item);
                } else {
                    second.push(item);
                }
            }
        }
        items.extend(second);
        Ok::<_, String>((items, steps, unread, notices, mode_used, rank_used))
    };
    // Check explicit files and attachment ownership before starting the web
    // planner. Whole-space retrieval can still run concurrently afterwards.
    let (local, web) = tokio::try_join!(biased; local_search, async {
        Ok::<_, String>(if clock.is_some() {
            // This continuation refers to a previously verified local schedule.
            // A public lookup cannot resolve a missing or stale local referent.
            WebTurn::default()
        } else {
            web(app, state, &config, question, request, started.web_access).await
        })
    })?;
    let (mut evidence, steps, unread, mut notices, local_mode, rank_used) = local;
    let mut trace = Trace {
        steps,
        unread,
        ..Default::default()
    };
    record_web_search(&mut trace, &web);
    if let Some(warning) = web.warning {
        notices.push(warning);
    }
    let selected_scope = !selection.is_empty();
    let expect_web = web.expected || !web.evidence.is_empty();
    let grounded = selected_scope || expect_web;
    let system = if grounded {
        providers::ANSWER_SYSTEM
    } else {
        GENERAL_SYSTEM
    };
    let mut prompt = if grounded {
        started.prompt_question.clone()
    } else {
        let original = serde_json::to_string(question).unwrap_or_default();
        let prior = started
            .previous_answer
            .as_deref()
            .map(|answer| serde_json::to_string(answer).unwrap_or_default())
            .unwrap_or_default();
        let previous = serde_json::to_string(
            &started
                .previous_questions
                .iter()
                .rev()
                .take(3)
                .map(|q| q.chars().take(350).collect::<String>())
                .collect::<Vec<_>>(),
        )
        .unwrap_or_default();
        format!("前几轮问题（由近到远，仅供对话）：{previous}\n上轮回答摘录（仅供编辑与追问）：{prior}\n当前问题：{original}")
    };
    let budget = config
        .context_chars
        .saturating_sub(system.chars().count() + prompt.chars().count() + 300);
    // Selected text transformations need their whole input. For a factual request
    // only the selected original sentences become evidence, just as in a scoped ask.
    let explicit = !selection.document_ids.is_empty() || !selection.attachments.is_empty();
    let request_body = request_text(question).0;
    let transform = transforms_text(&request_body)
        || ["写一", "写封", "拟一", "draft a", "write a"]
            .iter()
            .any(|s| request_body.contains(s));
    let read_selected = explicit && clock.is_none() && !transform;
    let mut review_failed = false;
    let mut provider_reviewed = false;
    let mut facet_refs = Vec::new();
    if read_selected {
        let same = || state.workspace_generation.load(Ordering::SeqCst) == generation;
        if !same() || state.cancel_chat.load(Ordering::SeqCst) {
            return Err("本轮候选核对已撤回".into());
        }
        evidence.truncate(8);
        let passages = selected_passages(data, &started.conversation_id, &evidence)?;
        let facets = crate::evidence_reader::split_facets(&retrieval::knowledge_query(question));
        let reviewed = crate::candidate_reading::review(
            state,
            &config,
            &facets,
            &passages,
            budget,
            true,
            || same() && current(data, &started.conversation_id, &evidence),
        )
        .await?;
        trace.steps.push(reviewed.step);
        review_failed = reviewed.warning.is_some();
        provider_reviewed = reviewed.stats.calls > 0;
        notices.extend(reviewed.warning);
        let mut selected: Vec<Evidence> = Vec::new();
        for facet in reviewed.reading.facets() {
            let mut ids = Vec::new();
            for q in &facet.quotes {
                let quote = crate::candidate_reading::verified_quote(&passages[q.source_index], q)?;
                let mut item = evidence[q.source_index].clone();
                let m = &mut item.metadata;
                let id = m
                    .document_id
                    .as_ref()
                    .or(m.attachment_id.as_ref())
                    .ok_or("所选资料缺少身份")?;
                m.id = format!("{id}:{}-{}", quote.start_line, quote.end_line);
                m.label = format!(
                    "{} · 第 {}–{} 行",
                    quote.title.as_deref().unwrap_or(id),
                    quote.start_line,
                    quote.end_line
                );
                // Distinguish two sentences on the same line without letting the model assign an ID.
                let ref_key = (m.id.clone(), quote.text.clone());
                if !selected
                    .iter()
                    .any(|e| e.metadata.id == m.id && e.text == quote.text)
                {
                    if m.kind == "document" {
                        m.excerpt = Some(quote.text.chars().take(3000).collect());
                    }
                    item.text = quote.text;
                    selected.push(item);
                }
                ids.push(ref_key);
            }
            facet_refs.push((facet.question.clone(), ids));
        }
        evidence = selected;
    }
    // Keep a table's header and selected row in the same context. If any part of
    // a facet is omitted by budgeting, that facet has no approved citation group.
    let note_reserve: usize = facet_refs
        .iter()
        .map(|(q, ids)| {
            crate::candidate_reading::facet_note(q, &vec![32; ids.len()])
                .chars()
                .count()
        })
        .sum();
    let mut external = choose_external_context(
        &evidence,
        &web.evidence,
        budget.saturating_sub(note_reserve),
        &mut trace.unread,
    );
    if read_selected {
        let complete: Vec<_> = facet_refs
            .iter()
            .filter(|(_, refs)| {
                !refs.is_empty()
                    && refs.iter().all(|(id, text)| {
                        external
                            .iter()
                            .any(|e| &e.metadata.id == id && &e.text == text)
                    })
            })
            .collect();
        external.retain(|e| {
            e.metadata.kind == "web"
                || complete.iter().any(|(_, refs)| {
                    refs.iter()
                        .any(|(id, text)| id == &e.metadata.id && text == &e.text)
                })
        });
        for (i, e) in external.iter_mut().enumerate() {
            e.metadata.citation = i + 1;
        }
        for (facet, refs) in facet_refs {
            let ids: Option<Vec<_>> = refs
                .iter()
                .map(|(id, text)| {
                    external
                        .iter()
                        .find(|e| &e.metadata.id == id && &e.text == text)
                        .map(|e| e.metadata.citation)
                })
                .collect();
            prompt.push_str(&crate::candidate_reading::facet_note(
                &facet,
                &ids.unwrap_or_default(),
            ));
        }
    }
    let has_local = external.iter().any(|e| e.metadata.kind != "web");
    let has_web = external.iter().any(|e| e.metadata.kind == "web");
    let route = AnswerRoute::from_context(selected_scope, expect_web, has_local, has_web);
    trace.route = route.as_str().into();
    if matches!(
        route,
        AnswerRoute::NoLocalEvidence | AnswerRoute::NoWebEvidence
    ) {
        let text = if route == AnswerRoute::NoLocalEvidence {
            if review_failed {
                "候选选句服务未能完成核对，本机也未取得可回答的原句。请检查问答服务后重试。"
            } else if clock.is_some() {
                "没有从上一轮已核对且仍在本轮范围内的原文找到这个发车时间。请说出线路、日期或文档名后重试。"
            } else {
                notices.push("可以补充资料、检查文档索引，或询问某一项具体信息。".into());
                "本轮所选资料未能核实这个问题。"
            }
        } else {
            "本轮未取得足够的网页证据，暂时无法核实请求。"
        };
        return Ok(response(
            "no_evidence",
            text.into(),
            "",
            vec![],
            trace,
            notices,
            None,
            &local_mode,
            &rank_used,
        ));
    }
    if web.expected && !has_web {
        prompt.push_str("\n公开资料未核验，只回答本轮已有原文支持的部分，明确指出缺少的外部证据。");
    }
    let context = external.iter().map(Evidence::as_prompt).collect::<String>();
    if selected_scope {
        let inputs = external
            .iter()
            .filter(|e| e.metadata.kind != "web")
            .map(|e| (e.metadata.citation, e.text.as_str()))
            .collect::<Vec<_>>();
        let available = config.context_chars.saturating_sub(
            system.chars().count() + context.chars().count() + prompt.chars().count() + 120,
        );
        crate::candidate_reading::add_calculation(question, &inputs, &mut prompt, available);
    }
    let remaining = config.context_chars.saturating_sub(
        system.chars().count() + prompt.chars().count() + context.chars().count() + 120,
    );
    let (preferences, usage) =
        assistant::memory::compose(data, assistant::GENERAL_OWNER, None, memory, remaining);
    prompt.push_str(&preferences);
    let user = format!("资料开始\n{context}\n资料结束\n\n问题：{prompt}");
    let key = crate::read_key(state, "chat", &config.base_url, &state.cancel_chat).await?;
    if provider_reviewed && !crate::candidate_reading::provider_allowed(state, &config)? {
        return Err("候选核对的传输设置已变化，已撤回本轮结果".into());
    }
    if (read_selected && state.workspace_generation.load(Ordering::SeqCst) != generation)
        || !current(data, &started.conversation_id, &external)
    {
        return Err("所选文档或附件已变化，请重新提问".into());
    }
    if state.cancel_chat.load(Ordering::SeqCst) {
        return Err("已停止生成".into());
    }
    if let Some(app) = app {
        progress(app, request, "generating", "正在生成回答");
    }
    let output = providers::stream_chat(
        &state.client,
        &config,
        key.as_deref(),
        system,
        &user,
        &state.cancel_chat,
        app,
        request,
    )
    .await?;
    if provider_reviewed && !crate::candidate_reading::provider_allowed(state, &config)? {
        return Err("候选核对的传输设置已变化，已撤回本轮结果".into());
    }
    if (read_selected && state.workspace_generation.load(Ordering::SeqCst) != generation)
        || !current(data, &started.conversation_id, &external)
    {
        return Ok(response(
            "source_changed",
            "所选资料已变化，已撤回本轮结果。".into(),
            "",
            vec![],
            trace,
            vec![],
            None,
            &local_mode,
            &rank_used,
        ));
    }
    let finish = if state.cancel_chat.load(Ordering::SeqCst) {
        if read_selected {
            return Err("已停止生成，已撤回候选核对结果".into());
        }
        "cancelled"
    } else {
        &output.finish_reason
    };
    Ok(response(
        finish,
        output.text,
        &config.model,
        external,
        trace,
        notices,
        Some(usage),
        &local_mode,
        &rank_used,
    ))
}

fn response(
    finish: &str,
    text: String,
    model: &str,
    evidence: Vec<Evidence>,
    trace: Trace,
    notices: Vec<String>,
    memory: Option<assistant::memory::Usage>,
    local_mode: &str,
    rank_used: &str,
) -> ChatResponse {
    let excerpts = evidence
        .iter()
        .map(Evidence::chart_source)
        .collect::<Vec<SearchResult>>();
    let audit = answer_validation::audit_charts(&text, &excerpts);
    let citation_checks = answer_validation::audit_citations(&text, finish, &excerpts);
    let retrieval_mode = match trace.route.as_str() {
        "local" if local_mode == "direct" => "selected",
        "local" => local_mode,
        mode => mode,
    }
    .into();
    ChatResponse {
        external_sources: evidence.into_iter().map(|e| e.metadata).collect(),
        trace: Some(trace),
        memory,
        finish_reason: finish.into(),
        text,
        sources: vec![],
        warning: (!notices.is_empty()).then(|| notices.join("\n")),
        retrieval_mode,
        rerank_status: rank_used.into(),
        model: model.into(),
        scope: None,
        chart_warnings: audit.warnings,
        rejected_charts: audit.rejected,
        citation_checks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_reservation_yields_to_the_only_local_excerpt_and_records_final_omissions() {
        let body = "所选本地原文。".repeat(150);
        let long = local_item(
            "document",
            "local",
            "本地原文",
            None,
            &body,
            (body.clone(), 1, 1),
        );
        let short = local_item(
            "document",
            "short",
            "短原文",
            None,
            "原文。",
            ("原文。".into(), 1, 1),
        );
        let public = local_item(
            "web",
            "web",
            "公共网页",
            None,
            "网页。",
            ("网页。".into(), 1, 1),
        );
        let budget = long.as_prompt().chars().count() + 1;
        let mut unread = vec!["范围内另有未检索资料".into()];
        let chosen = choose_external_context(
            std::slice::from_ref(&long),
            std::slice::from_ref(&public),
            budget,
            &mut unread,
        );
        assert_eq!(chosen.len(), 1);
        assert_eq!(chosen[0].metadata.id, long.metadata.id);
        assert_eq!(chosen[0].metadata.citation, 1);
        assert_eq!(unread, ["范围内另有未检索资料", &public.metadata.label]);

        let mut unread = Vec::new();
        let chosen = choose_external_context(
            &[long.clone(), short.clone()],
            std::slice::from_ref(&public),
            budget,
            &mut unread,
        );
        assert_eq!(chosen.len(), 2);
        assert_eq!(chosen[0].metadata.id, short.metadata.id);
        assert_eq!(chosen[1].metadata.id, public.metadata.id);
        assert_eq!(chosen[1].metadata.citation, 2);
        assert_eq!(unread, [long.metadata.label]);
    }

    #[test]
    fn only_unscoped_questions_may_use_web_as_their_only_evidence() {
        assert_eq!(
            AnswerRoute::from_context(true, true, false, true),
            AnswerRoute::NoLocalEvidence
        );
        assert_eq!(
            AnswerRoute::from_context(true, true, true, true),
            AnswerRoute::Mixed
        );
        assert_eq!(
            AnswerRoute::from_context(true, false, true, false),
            AnswerRoute::Local
        );
        assert_eq!(
            AnswerRoute::from_context(false, true, false, true),
            AnswerRoute::Web
        );
        assert_eq!(
            AnswerRoute::from_context(false, true, false, false),
            AnswerRoute::NoWebEvidence
        );
        assert_eq!(
            AnswerRoute::from_context(false, false, false, false),
            AnswerRoute::Direct
        );
    }

    #[test]
    fn empty_selected_files_do_not_supply_evidence() {
        for text in ["", "\r\n   \t\n"] {
            assert!(snippets("内容是什么", "空白.md", text).is_empty());
        }
        assert_eq!(
            snippets("内容是什么", "资料.md", "可引用内容")[0].0,
            "可引用内容"
        );
    }

    #[test]
    fn clock_excerpt_requires_current_source_identity_and_real_requested_time() {
        let body = "4月22日接驳车首班为06:30；最后一班为20:05。";
        let prior = local_item(
            "document",
            "verified",
            "北岭安排",
            Some("inbox"),
            body,
            (body.into(), 1, 1),
        )
        .metadata;
        let sources = &[prior];
        assert!(prior_local_source_matches(
            sources,
            "verified",
            Some("inbox"),
            body
        ));
        assert!(!prior_local_source_matches(
            sources,
            "different",
            Some("inbox"),
            body
        ));
        assert!(!prior_local_source_matches(
            sources,
            "verified",
            Some("other"),
            body
        ));
        assert!(!prior_local_source_matches(
            sources,
            "verified",
            Some("inbox"),
            "替换后的安排"
        ));
        assert_eq!(clock_snippets("末班", "北岭安排", body).len(), 1);
        assert!(clock_snippets("末班", "北岭安排", "首班为06:30。末班时刻未公布。").is_empty());
    }

    #[test]
    fn supplied_text_transform_skips_web_planning_and_needs_no_public_evidence() {
        for question in [
            "本轮不联网。请把“今天图书馆不开门”翻译成英文。",
            "请把今天图书馆不开门翻译成英文。",
            "润色：今天公司将发布最新进展。",
            "把‘请联网搜索今天的新闻’翻译成英文。",
            "写一首关于官网的诗。",
            "Translate \"The official website published its latest update today\" into Chinese.",
            "Write a reminder for tomorrow's workshop.",
        ] {
            assert_eq!(
                web_route(question, WebAccess::Auto),
                WebRoute::Skip,
                "{question}"
            );
            assert_eq!(
                web_route(question, WebAccess::LocalOnly),
                WebRoute::Skip,
                "{question}"
            );
        }
    }

    #[test]
    fn explicit_policy_stops_planning_and_public_lookup_still_requires_evidence() {
        for question in [
            "请核实 Python 最新稳定版本",
            "请只参考 Python 官网，核对 Python 3.14.0 的发布日期。",
            "联网搜索最新公告并翻译为英文。",
            "请翻译‘示例文字’，并核对官网的最新数据。",
            "今天北京天气怎么样？",
            "今天图书馆开门吗？",
            "What is today's weather?",
        ] {
            assert_eq!(
                web_route(question, WebAccess::Auto),
                WebRoute::Plan {
                    evidence_expected: true
                },
                "{question}"
            );
            assert_eq!(
                web_route(question, WebAccess::LocalOnly),
                WebRoute::Blocked,
                "{question}"
            );
        }
        assert_eq!(
            web_route(
                "不要访问外部网站。请核对 Python 最新版本。",
                WebAccess::Auto
            ),
            WebRoute::Blocked
        );
        assert_eq!(
            web_route("解释一下向量检索", WebAccess::Auto),
            WebRoute::Plan {
                evidence_expected: false
            }
        );
        assert_eq!(
            web_route("解释一下向量检索", WebAccess::LocalOnly),
            WebRoute::Skip
        );
        assert_eq!(
            web_route("不要访问外部网站。解释一下向量检索。", WebAccess::Auto),
            WebRoute::Skip
        );
        assert_eq!(
            web_route("只用我的资料，核实今天的官网公告。", WebAccess::Auto),
            WebRoute::Blocked
        );
    }

    #[test]
    fn trace_distinguishes_failed_empty_and_unreadable_web_searches() {
        for reason in [
            "Brave Search 请求超时。",
            "Brave Search 额度或速率受限，请稍后再试。",
        ] {
            let web = finish_web_search(Err(reason.into()));
            let mut trace = Trace::default();
            record_web_search(&mut trace, &web);
            assert_eq!(
                AnswerRoute::from_context(false, web.expected, false, false).as_str(),
                "web-unavailable"
            );
            assert!(trace.steps.is_empty());
            let warning = web.warning.unwrap();
            assert!(warning.contains(reason));
            assert!(!warning.contains("。。"));
            assert!(warning.contains("测试连接"));
        }

        let web = finish_web_search(Ok(web_retrieval::WebResults {
            searched: 0,
            discarded: 0,
            evidence: vec![],
        }));
        let mut trace = Trace::default();
        record_web_search(&mut trace, &web);
        assert_eq!(trace.steps, ["公开网页 · 检查 0 条候选"]);
        assert!(web.warning.unwrap().contains("未返回网页候选"));

        let web = finish_web_search(Ok(web_retrieval::WebResults {
            searched: 2,
            discarded: 2,
            evidence: vec![],
        }));
        let mut trace = Trace::default();
        record_web_search(&mut trace, &web);
        assert_eq!(
            AnswerRoute::from_context(false, web.expected, true, false).as_str(),
            "local"
        );
        assert_eq!(trace.steps, ["公开网页 · 检查 2 条候选"]);
        assert!(web.warning.unwrap().contains("未取得可引用的网页正文"));
    }
}
